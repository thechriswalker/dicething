import { browser } from '$app/environment';
import { defaultFont } from '$lib/fonts';
import {
	BUILD_PLATE_PRESETS,
	CUSTOM_PLATE_ID,
	DEFAULT_BUILD_PLATE_ID
} from '$lib/utils/build_plates';
import {
	DEFAULT_SUPPORT_LAYER_VISIBILITY,
	DEFAULT_SUPPORT_SETTINGS,
	mergeSupportSettings,
	type SupportLayerVisibility,
	type SupportSettings
} from '$lib/utils/supports/types';

// Global, app-wide user preferences. Persisted as a single JSON object under the
// `dt:prefs` localStorage key. Mirrors the reactive + cross-tab-sync pattern used
// by storage.svelte.ts (module-level $state, a `storage` event listener) rather
// than the buggy/unused LocalStore in utils/storage.svelte.ts.

const PREFS_KEY = 'dt:prefs';

export type Preferences = {
	// default engraving depth seeded into new dice (mirrors engravingParam.defaultValue).
	defaultEngravingDepth: number;
	// id of the legend set selected by default in the new-set preset picker.
	// may be a builtin key/id or a custom legend set id.
	defaultLegendSet: string;
	// default minimum inset (clearance) of legends from a face edge, seeded into
	// new dice. Matches the historical hardcoded engrave() clearance of 0.5.
	defaultEngravingTolerance: number;
	// developer/debug mode: enables wireframe + FPS stats on scenes, the raw /
	// JSON parameter editors, and unfinished features like the box builder.
	developerMode: boolean;
	/** Global default sizes for automatic SLA supports. */
	supportSettings: SupportSettings;
	/** Global default layer visibility (edges, legends, tip post). */
	supportLayers: SupportLayerVisibility;
	/** How the export preview arranges objects. */
	exportArrange: 'grid' | 'plate';
	/** Last build plate used by "fit to build plate". */
	buildPlate: BuildPlatePreference;
};

export type BuildPlatePreference = {
	/** A BUILD_PLATE_PRESETS key, or CUSTOM_PLATE_ID. */
	preset: string;
	/** Millimetres. Matches the preset unless preset is custom. */
	x: number;
	y: number;
	/** 0–1 opacity of the plate preview. */
	opacity: number;
};

const defaultPlate = BUILD_PLATE_PRESETS[DEFAULT_BUILD_PLATE_ID];

const defaults: Preferences = {
	defaultEngravingDepth: 0.8,
	defaultLegendSet: defaultFont.id,
	defaultEngravingTolerance: 0.5,
	developerMode: false,
	supportSettings: { ...DEFAULT_SUPPORT_SETTINGS },
	supportLayers: { ...DEFAULT_SUPPORT_LAYER_VISIBILITY },
	exportArrange: 'grid',
	buildPlate: {
		preset: DEFAULT_BUILD_PLATE_ID,
		x: defaultPlate.x,
		y: defaultPlate.y,
		opacity: 0.35
	}
};

// reactive singleton holding the current preferences.
let prefs = $state<Preferences>({ ...defaults });

function load(): Preferences {
	if (!browser) {
		return { ...defaults };
	}
	try {
		const raw = localStorage.getItem(PREFS_KEY);
		if (!raw) {
			return { ...defaults };
		}
		const parsed = JSON.parse(raw) as Partial<Preferences>;
		// merge over defaults so new keys (added in later versions) fall back cleanly.
		const merged = { ...defaults, ...parsed };
		merged.supportSettings = mergeSupportSettings(parsed.supportSettings);
		merged.supportLayers = {
			...DEFAULT_SUPPORT_LAYER_VISIBILITY,
			...(parsed.supportLayers ?? {})
		};
		merged.buildPlate = sanitizeBuildPlate(parsed.buildPlate);
		if (parsed.exportArrange !== 'grid' && parsed.exportArrange !== 'plate') {
			merged.exportArrange = defaults.exportArrange;
		}
		return merged;
	} catch {
		return { ...defaults };
	}
}

if (browser) {
	prefs = load();
	window.addEventListener('storage', (ev: StorageEvent) => {
		if (ev.storageArea !== localStorage || ev.key !== PREFS_KEY) {
			return;
		}
		// another tab changed preferences; re-load to converge.
		const next = load();
		Object.assign(prefs, next);
	});
}

// the live, reactive preferences object. Read fields directly (they are runes-
// backed) and persist changes via setPreference / updatePreferences.
export function getPreferences(): Preferences {
	return prefs;
}

function sanitizeBuildPlate(raw: Partial<BuildPlatePreference> | undefined): BuildPlatePreference {
	const plate: BuildPlatePreference = { ...defaults.buildPlate, ...(raw ?? {}) };
	if (plate.preset !== CUSTOM_PLATE_ID && !BUILD_PLATE_PRESETS[plate.preset]) {
		plate.preset = CUSTOM_PLATE_ID;
	}
	if (plate.preset !== CUSTOM_PLATE_ID) {
		const size = BUILD_PLATE_PRESETS[plate.preset];
		plate.x = size.x;
		plate.y = size.y;
	} else {
		if (!Number.isFinite(plate.x) || plate.x <= 0) {
			plate.x = defaults.buildPlate.x;
		}
		if (!Number.isFinite(plate.y) || plate.y <= 0) {
			plate.y = defaults.buildPlate.y;
		}
	}
	plate.opacity = Number.isFinite(plate.opacity)
		? Math.min(1, Math.max(0, plate.opacity))
		: defaults.buildPlate.opacity;
	return plate;
}

function persist() {
	if (browser) {
		localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
	}
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
	prefs[key] = value;
	persist();
}

export function updatePreferences(patch: Partial<Preferences>) {
	Object.assign(prefs, patch);
	persist();
}
