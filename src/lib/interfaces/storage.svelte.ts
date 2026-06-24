import dice from '$lib/dice/index';
import { Vector2 } from 'three';
import type { FaceParams } from './dice';
import {
	loadMutableLegends,
	type LegendSet,
	type MutableLegendSet,
	type SerialisedLegendSet
} from '$lib/utils/legends';
import builtins, { blanks, isBuiltin, loadBuiltinById } from '$lib/fonts';
import { defaultSources } from '$lib/utils/create_legends';
import { browser } from '$app/environment';
import { deferred } from '$lib/utils/deferred';
import { deleteFont, getFont, putFont } from './fontstore';

// fired (same-tab) whenever a custom legend set is saved or deleted, with the
// affected id as the event detail. Cross-tab changes arrive via the localStorage
// 'storage' event below, which re-dispatches this same event so consumers only
// need to listen in one place. Mirrors the light/dark sync pattern.
export const LEGENDS_CHANGED_EVENT = 'legends:changed';

function dispatchLegendsChanged(id: string) {
	if (browser) {
		window.dispatchEvent(new CustomEvent(LEGENDS_CHANGED_EVENT, { detail: id }));
	}
}

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

export function dieToJSON(die: Dice): string {
	// this is actually the same...
	return toJson(die);
}
export function dieFromJSON(json: string): Dice {
	return JSON.parse(json, reviver) as Dice;
}

export function diceToJSON(dice: Dice[]): string {
	return toJson(dice);
}
export function diceFromJSON(json: string): Dice[] {
	return JSON.parse(json, reviver) as Dice[];
}

function diceSetToJSON(diceSet: DiceSetForStorage): string {
	return toJson(diceSet);
}
function toJson(data: any): string {
	return JSON.stringify(data, (key, value) => {
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
	if (typeof value === 'object' && value && value._ === 'v2') {
		return new Vector2(value.x, value.y);
	}
	return value;
};

// we want to make these reactive
let savedSets = $state<Array<DiceSet>>([]);
// reactive list of the user's custom legend sets, kept fresh by the storage
// listener below. Used by the legend manager UI.
let savedLegends = $state<Array<MutableLegendSet>>([]);
let initialLoad = deferred();

export async function waitForInitialLoad() {
	await initialLoad.promise;
}

export async function waitForSet(id: string): Promise<DiceSet | undefined> {
	await waitForInitialLoad();
	return savedSets.find((set) => set.id === id);
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
		} else if (ev.key?.startsWith(LEGENDS_PREFIX)) {
			// a custom legend set changed in another tab; keep our list in sync
			// and re-dispatch the same-tab event so consumers converge on one path.
			const id = ev.key.slice(LEGENDS_PREFIX.length);
			if (ev.newValue === null) {
				removeLegendsFromList(id);
			} else {
				try {
					upsertLegendsInList(loadMutableLegends(JSON.parse(ev.newValue)));
				} catch (e) {
					console.warn('failed to parse updated legend set', e);
				}
			}
			dispatchLegendsChanged(id);
		}
	};

	getListOfSets()
		.then((sets) => {
			savedSets.push(...sets);
			initialLoad.resolve(undefined);
		})
		.catch((e) => console.warn(e));
	savedLegends.push(...getListOfCustomLegends());
	window.addEventListener('storage', storageListener);
}
export function getSavedSets() {
	return savedSets;
}

export function getSavedLegends() {
	return savedLegends;
}

function upsertLegendsInList(set: MutableLegendSet) {
	const idx = savedLegends.findIndex((x) => x.id === set.id);
	if (idx === -1) {
		savedLegends.push(set);
	} else {
		savedLegends.splice(idx, 1, set);
	}
	// Each cached DiceSet holds its own LegendSet instance (resolved when the set
	// was loaded), separate from the one being edited. Point any set using this id
	// at the freshly-saved instance so a builder reading waitForSet() after an edit
	// (e.g. returning from the legend editor route) picks up the new shapes instead
	// of the stale ones it was first built with.
	for (const s of savedSets) {
		if (s.legends.id === set.id) {
			s.legends = set;
		}
	}
}

function removeLegendsFromList(id: string) {
	const idx = savedLegends.findIndex((x) => x.id === id);
	if (idx > -1) {
		savedLegends.splice(idx, 1);
	}
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

export async function loadLegends(id: string): Promise<LegendSet> {
	if (isBuiltin(id)) {
		return loadBuiltinById(id);
	}
	// builtin metadata keys are un-prefixed (e.g. "germania_one"), but the
	// canonical builtin legend-set id is prefixed ("builtin:germania_one"). The
	// preset legend picker stores the metadata key, so accept that form too.
	if (id in builtins) {
		return loadBuiltinById('builtin:' + id);
	}
	// try and load from localstorage (fresh instance reflecting the latest save)
	const legends = getListOfCustomLegends();
	const legend = legends.find((x) => x.id === id);
	return legend ?? blanks;
}

// Look up a (live, reactive) custom legend set by id from the in-memory list.
export function getCustomLegendSet(id: string): MutableLegendSet | undefined {
	return savedLegends.find((x) => x.id === id);
}

// Persist a custom legend set and notify listeners (same-tab + cross-tab).
export function saveLegendSet(set: MutableLegendSet) {
	set.updated = Date.now();
	localStorage.setItem(LEGENDS_PREFIX + set.id, JSON.stringify(set));
	upsertLegendsInList(set);
	dispatchLegendsChanged(set.id);
}

// Remove a custom legend set and its uploaded font blob (if any).
export async function deleteLegendSet(id: string) {
	localStorage.removeItem(LEGENDS_PREFIX + id);
	removeLegendsFromList(id);
	try {
		await deleteFont(id);
	} catch (e) {
		console.warn('failed to delete font blob', e);
	}
	dispatchLegendsChanged(id);
}

// Clone any legend set (builtin or custom) into a new, editable custom set.
// Builtin clones reference the builtin font (served from the bundle); uploaded
// clones get a copy of the source font blob so they can also add glyphs.
export async function cloneLegendSet(src: LegendSet): Promise<MutableLegendSet> {
	const id = crypto.randomUUID();
	const serial = src.toJSON();
	let font = serial.font;
	let sources = serial.sources;
	if (isBuiltin(src.id)) {
		const builtinId = src.id.slice('builtin:'.length);
		font = { kind: 'builtin', builtinId };
		// Builtins are bundled without their per-slot sources. Rebuild them from
		// the standard combined set so the clone's glyphs keep their "characters"
		// (editable / regenerable).
		if (!sources || sources.length === 0) {
			sources = defaultSources();
		}
	} else if (font?.kind === 'uploaded') {
		try {
			const blob = await getFont(src.id);
			if (blob) {
				await putFont(id, blob);
			}
		} catch (e) {
			console.warn('failed to copy font blob for clone', e);
		}
	}
	const clone = loadMutableLegends({ ...serial, id, font, sources, updated: Date.now() });
	saveLegendSet(clone);
	return clone;
}

// Import a serialised legend set (e.g. from an exported JSON file) as a new
// custom set. An uploaded-font origin is dropped (we don't have the blob).
export function importLegendSet(json: string): MutableLegendSet {
	const obj = JSON.parse(json) as SerialisedLegendSet;
	if (!Array.isArray(obj.shapes) || !Array.isArray(obj.names)) {
		throw new Error('Not a valid legend set file');
	}
	const id = crypto.randomUUID();
	const font = obj.font?.kind === 'builtin' ? obj.font : undefined;
	const set = loadMutableLegends({ ...obj, id, font, updated: Date.now() });
	saveLegendSet(set);
	return set;
}

// Which saved dice sets currently use the given legend set id. Used to gate
// deletion (we don't allow deleting legends a dice set depends on).
export function setsUsingLegend(id: string): Array<DiceSet> {
	return savedSets.filter((s) => s.legends.id === id);
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
