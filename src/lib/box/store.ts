// Persistence for box configs. Each box belongs to a dice set and is stored
// under its own localStorage key (prefix `dt:boxes:<setId>`), mirroring how
// storage.svelte.ts keeps dice sets and legend sets. A box is always derived
// from a set, so the set id is the natural key.

import { browser } from '$app/environment';
import type { Dice } from '$lib/interfaces/storage.svelte';
import { defaultBoxParams, type BoxConfig, type BoxDiePlacement } from './types';

const BOXES_PREFIX = 'dt:boxes:';

// A fresh box config for a set: every die included, in set order.
export function defaultBoxConfig(setId: string, dice: Array<Dice>): BoxConfig {
	const placements: Array<BoxDiePlacement> = dice.map((d, i) => ({
		dieId: d.id,
		order: i,
		rotation: 0,
		x: 0,
		y: 0,
		include: true
	}));
	return {
		setId,
		updated: Date.now(),
		params: defaultBoxParams(),
		placements
	};
}

// Load a saved box config for a set, or undefined if none exists / it's invalid.
export function loadBoxConfig(setId: string): BoxConfig | undefined {
	if (!browser) {
		return undefined;
	}
	const raw = localStorage.getItem(BOXES_PREFIX + setId);
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as BoxConfig;
		if (!parsed || parsed.setId !== setId || !Array.isArray(parsed.placements)) {
			return undefined;
		}
		// migrate a legacy single `trayDepth` to the per-half tray depths.
		const legacyTray = parsed.params as Partial<{ trayDepth: number }> | undefined;
		if (legacyTray && typeof legacyTray.trayDepth === 'number') {
			parsed.params.trayDepthBase ??= legacyTray.trayDepth;
			parsed.params.trayDepthLid ??= legacyTray.trayDepth;
			delete legacyTray.trayDepth;
		}
		// migrate a legacy single `margin` to the split x/y margins before merging
		// defaults (so an old config keeps its chosen margin on both axes).
		const legacy = parsed.params as Partial<{ margin: number }> | undefined;
		if (legacy && typeof legacy.margin === 'number') {
			parsed.params.marginX ??= legacy.margin;
			parsed.params.marginY ??= legacy.margin;
			delete legacy.margin;
		}
		// merge over defaults so configs saved before a param was added still load.
		parsed.params = { ...defaultBoxParams(), ...parsed.params };
		parsed.params.magnets = { ...defaultBoxParams().magnets, ...parsed.params.magnets };
		parsed.params.hinge = { ...defaultBoxParams().hinge, ...parsed.params.hinge };
		parsed.params.box = { ...defaultBoxParams().box, ...parsed.params.box };
		// default per-placement manual position (added with the 2D layout editor).
		for (const pl of parsed.placements) {
			pl.x ??= 0;
			pl.y ??= 0;
		}
		return parsed;
	} catch {
		return undefined;
	}
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

export function saveBoxConfig(config: BoxConfig): void {
	if (!browser) {
		return;
	}
	config.updated = Date.now();
	localStorage.setItem(BOXES_PREFIX + config.setId, JSON.stringify(config));
}

export function deleteBoxConfig(setId: string): void {
	if (!browser) {
		return;
	}
	localStorage.removeItem(BOXES_PREFIX + setId);
}
