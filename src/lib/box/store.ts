// Persistence for box configs. Each box is its own localStorage record under
// `dt:boxes:<boxId>`, so one dice set can have several boxes. A legacy record
// (keyed by set id, no `id` field) is adopted in place: the set id becomes the
// box id and is written back onto the same key, so an old /boxes/<setId> link
// still opens that box.

import { browser } from '$app/environment';
import type { Dice } from '$lib/interfaces/storage.svelte';
import { uuid } from '$lib/utils/uuid';
import { defaultBoxParams, type BoxConfig, type BoxDiePlacement, type BoxParams } from './types';

const BOXES_PREFIX = 'dt:boxes:';

export type BoxStorage = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key(index: number): string | null;
	readonly length: number;
};

// A fresh box config for a set: every die included, in set order.
export function defaultBoxConfig(
	setId: string,
	dice: Array<Dice>,
	name: string,
	id: string = uuid()
): BoxConfig {
	const placements: Array<BoxDiePlacement> = dice.map((d, i) => ({
		dieId: d.id,
		order: i,
		rotation: 0,
		x: 0,
		y: 0,
		include: true
	}));
	return {
		id,
		name,
		setId,
		updated: Date.now(),
		params: defaultBoxParams(),
		placements
	};
}

// "Travel" is free; if it's taken, "Travel 2", "Travel 3", ...
export function uniqueBoxName(base: string, taken: Iterable<string>): string {
	const names = new Set(taken);
	const trimmed = base.trim() || 'Box';
	if (!names.has(trimmed)) {
		return trimmed;
	}
	let n = 2;
	while (names.has(`${trimmed} ${n}`)) {
		n++;
	}
	return `${trimmed} ${n}`;
}

// Fill in a name for boxes saved before boxes had names (or migrated legacy
// records). `save` persists each box that changed. Already-named boxes are
// left untouched.
export function backfillBoxNames(
	boxes: Array<BoxConfig>,
	setName: (setId: string) => string | undefined,
	save: (config: BoxConfig) => BoxConfig
): Array<BoxConfig> {
	const next = boxes.slice();
	for (let i = 0; i < next.length; i++) {
		if (next[i].name.trim()) {
			continue;
		}
		const taken = next.filter((o) => o.id !== next[i].id).map((o) => o.name);
		const named = {
			...next[i],
			name: uniqueBoxName(setName(next[i].setId) ?? 'Box', taken)
		};
		next[i] = save(named);
	}
	return next;
}

// Resolve a /boxes/<param> link. A box id wins. A set id opens that set's box
// when it has exactly one (the pre-migration URL was the set id).
export function boxForRouteParam(boxes: Array<BoxConfig>, param: string): BoxConfig | undefined {
	const byId = boxes.find((b) => b.id === param);
	if (byId) {
		return byId;
	}
	const bySet = boxes.filter((b) => b.setId === param);
	return bySet.length === 1 ? bySet[0] : undefined;
}

type RawParams = Partial<BoxParams> & {
	trayDepth?: number;
	margin?: number;
	marginX?: number;
	marginY?: number;
};

type StoredBox = {
	id?: unknown;
	name?: unknown;
	setId?: unknown;
	updated?: unknown;
	params?: RawParams;
	placements?: unknown;
};

function normalizeParams(raw: unknown): BoxParams {
	const defaults = defaultBoxParams();
	const src: RawParams = raw && typeof raw === 'object' ? { ...(raw as RawParams) } : {};
	if (typeof src.trayDepth === 'number') {
		src.trayDepthBase ??= src.trayDepth;
		src.trayDepthLid ??= src.trayDepth;
	}
	delete src.trayDepth;
	delete src.margin;
	delete src.marginX;
	delete src.marginY;
	const params: BoxParams = { ...defaults, ...src };
	params.magnets = { ...defaults.magnets, ...(src.magnets ?? {}) };
	params.hinge = { ...defaults.hinge, ...(src.hinge ?? {}) };
	params.box = { ...defaults.box, ...(src.box ?? {}) };
	return params;
}

function normalizePlacements(raw: unknown): Array<BoxDiePlacement> | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const placements: Array<BoxDiePlacement> = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') {
			return undefined;
		}
		const pl = item as Partial<BoxDiePlacement>;
		if (typeof pl.dieId !== 'string') {
			return undefined;
		}
		placements.push({
			dieId: pl.dieId,
			order: typeof pl.order === 'number' ? pl.order : placements.length,
			rotation: typeof pl.rotation === 'number' ? pl.rotation : 0,
			x: typeof pl.x === 'number' ? pl.x : 0,
			y: typeof pl.y === 'number' ? pl.y : 0,
			include: pl.include !== false
		});
	}
	return placements;
}

// Parse one stored record. `storageKey` is the localStorage key without the
// prefix. Returns whether the record must be written back (legacy, or stored
// under a key that isn't its id).
export function normalizeStoredBox(
	raw: unknown,
	storageKey: string
): { config: BoxConfig; rewrite: boolean } | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const parsed = raw as StoredBox;
	const placements = normalizePlacements(parsed.placements);
	if (!placements) {
		return undefined;
	}
	const storedId = typeof parsed.id === 'string' ? parsed.id : '';
	const hadId = storedId.length > 0;
	const id = hadId ? storedId : storageKey;
	const setId =
		typeof parsed.setId === 'string' && parsed.setId ? parsed.setId : hadId ? '' : storageKey;
	if (!setId) {
		return undefined;
	}
	const config: BoxConfig = {
		id,
		name: typeof parsed.name === 'string' ? parsed.name : '',
		setId,
		updated: typeof parsed.updated === 'number' ? parsed.updated : 0,
		params: normalizeParams(parsed.params),
		placements
	};
	return { config, rewrite: !hadId || storageKey !== id };
}

function storageKeys(store: BoxStorage): Array<string> {
	const keys: Array<string> = [];
	for (let i = 0; i < store.length; i++) {
		const key = store.key(i);
		if (key?.startsWith(BOXES_PREFIX)) {
			keys.push(key);
		}
	}
	return keys;
}

export function listBoxesIn(store: BoxStorage): Array<BoxConfig> {
	const boxes: Array<BoxConfig> = [];
	for (const key of storageKeys(store)) {
		const raw = store.getItem(key);
		if (!raw) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		const norm = normalizeStoredBox(parsed, key.slice(BOXES_PREFIX.length));
		if (!norm) {
			continue;
		}
		const idKey = BOXES_PREFIX + norm.config.id;
		if (norm.rewrite) {
			store.setItem(idKey, JSON.stringify(norm.config));
			if (key !== idKey) {
				store.removeItem(key);
			}
		}
		boxes.push(norm.config);
	}
	boxes.sort((a, b) => b.updated - a.updated);
	return boxes;
}

export function loadBoxIn(store: BoxStorage, id: string): BoxConfig | undefined {
	const raw = store.getItem(BOXES_PREFIX + id);
	if (!raw) {
		return undefined;
	}
	try {
		const norm = normalizeStoredBox(JSON.parse(raw), id);
		if (!norm || norm.config.id !== id) {
			return undefined;
		}
		return norm.config;
	} catch {
		return undefined;
	}
}

export function saveBoxIn(store: BoxStorage, config: BoxConfig): BoxConfig {
	// Never mutate the caller's object: the designer tracks config in $state,
	// and bumping `updated` on the live proxy retriggers the save effect.
	const toSave: BoxConfig = { ...config, updated: Date.now() };
	store.setItem(BOXES_PREFIX + config.id, JSON.stringify(toSave));
	return toSave;
}

export function deleteBoxIn(store: BoxStorage, id: string): void {
	store.removeItem(BOXES_PREFIX + id);
}

function browserStore(): BoxStorage | undefined {
	return browser ? localStorage : undefined;
}

export function listBoxConfigs(): Array<BoxConfig> {
	const store = browserStore();
	return store ? listBoxesIn(store) : [];
}

export function loadBoxConfig(id: string): BoxConfig | undefined {
	const store = browserStore();
	return store ? loadBoxIn(store, id) : undefined;
}

export function saveBoxConfig(config: BoxConfig): BoxConfig {
	const store = browserStore();
	if (!store) {
		return config;
	}
	return saveBoxIn(store, config);
}

export function deleteBoxConfig(id: string): void {
	const store = browserStore();
	if (!store) {
		return;
	}
	deleteBoxIn(store, id);
}

// Reconcile a config with the set's current dice: keep placements for dice that
// still exist (in their saved order) and append fresh placements for any newly
// added dice. Returns a new config; does not persist.
export function reconcileBoxConfig(config: BoxConfig, dice: Array<Dice>): BoxConfig {
	const byId = new Map(config.placements.map((p) => [p.dieId, p]));
	const ids = new Set(dice.map((d) => d.id));
	const kept = config.placements.filter((p) => ids.has(p.dieId));
	let maxOrder = kept.reduce((m, p) => Math.max(m, p.order), -1);
	const placements: Array<BoxDiePlacement> = [...kept];
	for (const d of dice) {
		if (!byId.has(d.id)) {
			// new dice land at the origin; in a manual layout the user repositions
			// them in the editor (the build tolerates an overlapping die at 0,0).
			placements.push({
				dieId: d.id,
				order: ++maxOrder,
				rotation: 0,
				x: 0,
				y: 0,
				include: true
			});
		}
	}
	return { ...config, placements };
}
