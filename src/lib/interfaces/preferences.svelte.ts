import { browser } from '$app/environment';
import { defaultFont } from '$lib/fonts';

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
	// developer/debug mode: enables wireframe + FPS stats on scenes and the raw /
	// JSON parameter editors.
	developerMode: boolean;
};

const defaults: Preferences = {
	defaultEngravingDepth: 0.8,
	defaultLegendSet: defaultFont.id,
	defaultEngravingTolerance: 0.5,
	developerMode: false
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
		return { ...defaults, ...parsed };
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
