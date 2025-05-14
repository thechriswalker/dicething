import dice from '$lib/dice/index';
import { Vector2 } from 'three';
import type { FaceParams } from './dice';
import { loadMutableLegends, type LegendSet, type SerialisedLegendSet } from '$lib/utils/legends';
import { blanks, isBuiltin, loadBuiltinById } from '$lib/fonts';
import { browser } from '$app/environment';
import { deferred } from '$lib/utils/deferred';

const LOCALSTORAGE_PREFIX = 'dt:';

const DICE_SETS_PREFIX = LOCALSTORAGE_PREFIX + 'sets:';
const LEGENDS_PREFIX = LOCALSTORAGE_PREFIX + 'legends:';

export type DiceSetWithoutLegends = {
	id: string;
	name: string;
	updated: number; // unix millis
	dice: Dice[];
};

export type DiceSet = DiceSetWithoutLegends & { legends: LegendSet };

type DiceSetForStorage = DiceSetWithoutLegends & { legends: string };

export type Dice = {
	id: string;
	kind: keyof typeof dice;
	parameters: Record<string, number>;
	face_parameters: Array<FaceParams>;
};

function diceSetToJSON(diceSet: DiceSetForStorage): string {
	return JSON.stringify(diceSet, (key, value) => {
		if (value instanceof Vector2) {
			return { _: 'v2', x: value.x, y: value.y };
		}
		return value;
	});
}

function diceSetFromJSON(json: string): DiceSetForStorage {
	return JSON.parse(json, reviver);
}

type Defined<T> = T extends undefined ? never : T;

const reviver: Defined<Parameters<typeof JSON.parse>[1]> = (key, value) => {
	if (typeof value === 'object' && value._ === 'v2') {
		return new Vector2(value.x, value.y);
	}
	return value;
};

// we want to make these reactive
let savedSets = $state<Array<DiceSet>>([]);
let initialLoad = deferred();

export async function waitForInitialLoad() {
	await initialLoad.promise;
}

if (browser) {
	const storageListener = async (ev: StorageEvent) => {
		if (ev.storageArea !== localStorage) {
			return;
		}
		if (ev.key?.startsWith(DICE_SETS_PREFIX)) {
			const id = ev.key.slice(DICE_SETS_PREFIX.length);
			if (ev.newValue === null) {
				// removal
				deleteSet(id);
			} else {
				const { legends, ...stored } = diceSetFromJSON(ev.newValue);
				const legendSet = await loadLegends(legends);
				const set: DiceSet = { legends: legendSet, ...stored };
				const idx = savedSets.findIndex((x) => x.id === set.id);
				if (idx === -1) {
					savedSets.push(set);
				} else {
					savedSets.splice(idx, 1, set); // replace it in array
				}
			}
		}
		// if a legend set...
	};

	getListOfSets()
		.then((sets) => {
			savedSets.push(...sets);
			initialLoad.resolve(undefined);
		})
		.catch((e) => console.warn(e));
	window.addEventListener('storage', storageListener);
}
export function getSavedSets() {
	return savedSets;
}

export function saveSet(set: DiceSet) {
	const { legends, ...forStorage } = set;
	ensureLegendsPersisted(legends);
	(forStorage as DiceSetForStorage).legends = legends.id;
	const data = diceSetToJSON(forStorage as DiceSetForStorage);
	const key = DICE_SETS_PREFIX + set.id;
	set.updated = Date.now();
	localStorage.setItem(key, data);
	if (!savedSets.find((x) => x.id === set.id)) {
		// wasn't in the saved set array, so add it.
		savedSets.push(set);
	}
}

function ensureLegendsPersisted(legends: LegendSet) {
	if (isBuiltin(legends.id)) {
		return;
	}
	localStorage.setItem(LEGENDS_PREFIX + legends.id, JSON.stringify(legends));
}

export function deleteSet(setID: string) {
	const key = DICE_SETS_PREFIX + setID;
	localStorage.removeItem(key);
	const idx = savedSets.findIndex((x) => x.id === setID);
	if (idx > -1) {
		savedSets.splice(idx, 1);
	}
}

// I want to store data as a "map",
// each one will be a different key in localstorage
// to find them we need to iterate the localstorage to find entries with the prefix.
function getListOfSets() {
	const sets = findWithPrefixAsync(DICE_SETS_PREFIX, async (v) => {
		try {
			const { legends, ...stored } = diceSetFromJSON(v);
			const legendSet = await loadLegends(legends);
			const set: DiceSet = { legends: legendSet, ...stored };
			return set;
		} catch {
			// not good.
			return undefined;
		}
	});
	return sets;
}

async function loadLegends(id: string) {
	if (isBuiltin(id)) {
		return loadBuiltinById(id);
	}
	// try and load from localstorage
	const legends = getListOfCustomLegends();
	const legend = legends.find((x) => x.id === id);
	return legend ?? blanks;
}

export function getListOfCustomLegends() {
	const legends = findWithPrefixSync(LEGENDS_PREFIX, (v) => {
		try {
			const obj = JSON.parse(v) as SerialisedLegendSet;
			const legend = loadMutableLegends(obj);
			return legend;
		} catch {
			return undefined;
		}
	});
	return legends;
}

type MaybePromise<T> = T | Promise<T>;

async function findWithPrefixAsync<T>(
	prefix: string,
	fn: (v: string) => MaybePromise<T | undefined>
): Promise<Array<T>> {
	const keys: Array<string> = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && key.startsWith(prefix)) {
			keys.push(key);
		}
	}
	const values: Array<T> = [];
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const v = await fn(localStorage.getItem(key)!);
		if (v) {
			values.push(v);
		} else {
			// invalid, clear it
			localStorage.removeItem(key);
		}
	}
	return values;
}
function findWithPrefixSync<T>(prefix: string, fn: (v: string) => T | undefined): Array<T> {
	const keys: Array<string> = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && key.startsWith(prefix)) {
			keys.push(key);
		}
	}
	const values: Array<T> = [];
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const v = fn(localStorage.getItem(key)!);
		if (v) {
			values.push(v);
		} else {
			// invalid, clear it
			localStorage.removeItem(key);
		}
	}
	return values;
}
