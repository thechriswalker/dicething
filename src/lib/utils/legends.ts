import { Shape } from 'three';
import { m } from '$lib/paraglide/messages';
import { defaultStrings, legendNameForText } from './font';
import { shapeFromJSON, shapeToJSON } from './to_json';

export enum Legend {
	BLANK = -1,
	ZERO = 0,
	ONE = 1,
	TWO = 2,
	THREE = 3,
	FOUR = 4,
	FIVE = 5,
	SIX = 6,
	SEVEN = 7,
	EIGHT = 8,
	NINE = 9,
	TEN = 10,
	ELEVEN = 11,
	TWELVE = 12,
	THIRTEEN = 13,
	FOURTEEN = 14,
	FIFTEEN = 15,
	SIXTEEN = 16,
	SEVENTEEN = 17,
	EIGHTEEN = 18,
	NINETEEN = 19,
	TWENTY = 20,
	SIX_MARKED = 21, // i.e. underline or with a dot
	NINE_MARKED = 22, // i.e. underline or with a dot
	THIRTY = 23,
	FORTY = 24,
	FIFTY = 25,
	SIXTY = 26,
	SEVENTY = 27,
	EIGHTY = 28,
	NINETY = 29,
	DOUBLE_ZERO = 30,
	MAKER_LOGO = 31,
	// slots 32-103 hold the remaining numbers (21-99 that aren't a "tens"
	// glyph). Custom symbols start after those.
	CUSTOM_SYMBOLS_START = 104
}

// The maker logo lives at this slot; the legend generators splice it in here,
// between the standard slots (0-30) and the remaining numbers (32+).
export const MAKER_LOGO_SLOT = 31;

// Maps each source token (from defaultStrings) to its final slot index,
// accounting for the logo being spliced in at MAKER_LOGO_SLOT (tokens at or
// after that index shift up by one). Built once from the single source of
// truth in $lib/utils/font so the generators and the dice number->slot
// mapping can never drift apart.
const textToSlot: Map<string, Legend> = (() => {
	const map = new Map<string, Legend>();
	defaultStrings.split(' ').forEach((tok, i) => {
		const slot = (i < MAKER_LOGO_SLOT ? i : i + 1) as Legend;
		if (!map.has(tok)) {
			map.set(tok, slot);
		}
	});
	return map;
})();

// Inverse of textToSlot: the canonical source token for a slot. Used to derive
// a slot's localized name (via legend_name) at render time, now that there's a
// single canonical legend ordering and names no longer need to be baked in.
const slotToText: Map<Legend, string> = (() => {
	const map = new Map<Legend, string>();
	for (const [tok, slot] of textToSlot) {
		if (!map.has(slot)) {
			map.set(slot, tok);
		}
	}
	return map;
})();

// Localized display name for a known legend slot (blank, maker logo, or any of
// the canonical numeric/special slots), or undefined for custom-symbol slots
// (which carry a user-supplied name instead).
export function localizedLegendName(l: Legend): string | undefined {
	if (l === Legend.BLANK) {
		return m.legend_name({ key: 'blank', n: 0 });
	}
	if (l === Legend.MAKER_LOGO) {
		return m.legend_name({ key: 'logo', n: 0 });
	}
	const tok = slotToText.get(l);
	if (tok !== undefined) {
		return legendNameForText(tok);
	}
	// custom-symbol slots have no canonical token: number them from 1 via the
	// `legend_name` wildcard ("Custom Legend (n)").
	if (l >= Legend.CUSTOM_SYMBOLS_START) {
		return m.legend_name({ key: 'custom', n: l + 1 - Legend.CUSTOM_SYMBOLS_START });
	}
	return undefined;
}

// The Legend slot that should display a given numeric value. 6 and 9 resolve to
// their marked variants (as large dice always want the disambiguating dot);
// everything else is looked up by its literal text in the combined set.
export function legendForValue(value: number): Legend {
	if (value === 6) {
		return Legend.SIX_MARKED;
	}
	if (value === 9) {
		return Legend.NINE_MARKED;
	}
	const slot = textToSlot.get(String(value)); // this is the magic for large numbers.
	return slot === undefined ? Legend.BLANK : slot;
}

// a custom legend
export function CustomLegend(x: number): Legend {
	if (!Number.isInteger(x) || x < 0) {
		console.error('CustomLegend index invalid', x);
		throw new Error('CustomLegend index must be a positive integer');
	}
	return Legend.CUSTOM_SYMBOLS_START + x;
}

// this is for the D% dice, so ten sides. index range 0-9
export function pickForDoublesByIndex(index: number) {
	if (index < 0 || index > 9) {
		return Legend.BLANK;
	}
	const n = index + 1;
	switch (n) {
		case 10:
			return Legend.DOUBLE_ZERO;
		case 1:
			return Legend.TEN;
		case 2:
			return Legend.TWENTY;
		default:
			return 20 + n;
	}
}

// index should be in range 0 to (sides-1)
export function pickForNumber(index: number, sides: number): Legend {
	if (index < 0 || index >= sides) {
		return Legend.BLANK;
	}
	const n = index + 1;
	switch (n) {
		case 10:
			return sides == 10 ? Legend.ZERO : Legend.TEN;
		case 6:
			return sides > 8 ? Legend.SIX_MARKED : Legend.SIX;
		case 9:
			return Legend.NINE_MARKED; // not sure why we have a non-marked nine as we always need a mark...
		default:
			return n;
	}
}

// numbering for large dice (d24/d30/d60) where the value exceeds 20. the
// combined legend set holds 0-20 (+marked 6/9, tens, 00) at slots 0-30 and the
// remaining numbers at slots 32+, so a value no longer equals its slot index.
// legendForValue resolves the (non-linear) value -> slot mapping.
export function pickForNumberLarge(index: number): Legend {
	return legendForValue(index + 1);
}

//  useful for debugging...
export function debugLegendName(n: Legend): string {
	const s = n in Legend ? Legend[n] : `CUSTOM_SYMBOL_(${n})`;
	// to Title Case
	return s
		.split('_')
		.map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
		.join(' ');
}

// Where the source font for a legend set can be found when the user wants to
// generate *more* glyphs. Builtin fonts are served from the bundle (so we just
// need the builtin id), uploaded fonts are persisted in IndexedDB keyed by the
// legend set id (see $lib/interfaces/fontstore).
export type LegendFontOrigin = { kind: 'builtin'; builtinId: string } | { kind: 'uploaded' };

// Options for the generated underline modifier (e.g. for marked 6/9).
export type UnderlineOptions = {
	thickness: number;
	gap: number;
	widthScale: number;
	flip: boolean;
};

// The recipe used to (re)generate an individual legend, so the editor can tweak
// e.g. the characters or letter spacing later. Optional/per-slot.
export type LegendSource =
	| { kind: 'font'; text: string; letterSpacing?: number; underline?: UnderlineOptions }
	| { kind: 'svg' }
	| { kind: 'glyph'; from: string; legend: Legend };

export type LegendSet = {
	readonly id: string;
	readonly name: string;
	readonly mutable: boolean;
	readonly length: number;
	get(l: Legend): Array<Shape>;
	getLegendName(l: Legend): string;
	toJSON(): SerialisedLegendSet;
} & Iterable<Legend>;

export type SerialisedLegendSet = {
	id: string;
	name: string;
	names: Array<string>;
	shapes: Array<Array<any>>;
	// revision marker (unix millis), bumped on every save so consumers can
	// detect content changes for the same id.
	updated?: number;
	// where to find the source font to add more glyphs (custom sets only).
	font?: LegendFontOrigin;
	// per-slot generation recipe (custom sets only). aligned with shapes/names.
	sources?: Array<LegendSource | null>;
};

// these are the inbuilt ones.
export type ImmutableLegendSet = LegendSet & {
	readonly mutable: false;
	// create a copy of this set, but mutable
	// so the user can
	clone(): MutableLegendSet;
};

// a legend set that the user can update.
// need to use it to add "custom" legends
// to an existing font.
export type MutableLegendSet = LegendSet & {
	readonly mutable: true;
	name: string;
	font?: LegendFontOrigin;
	updated?: number;
	getSource(l: Legend): LegendSource | undefined;
	set(l: Legend, name: string, shapes: Array<Shape>, source?: LegendSource | null): void;
	// like set(), but accepts shapes already in the compact serialized form
	// (as produced by createShapesFromFont / createShapesFromSVG).
	setSerialized(
		l: Legend,
		name: string,
		shapes: Array<unknown>,
		source?: LegendSource | null
	): void;
};

export function loadImmutableLegends(s: SerialisedLegendSet): ImmutableLegendSet {
	const data = s.shapes.slice();
	const cache = new Map<Legend, Array<Shape>>();
	const load = (l: Legend) => {
		const shapes = data[l].map((ss) => shapeFromJSON(ss));
		cache.set(l, shapes);
		return shapes;
	};
	return {
		id: s.id,
		name: s.name,
		mutable: false,
		get length() {
			return data.length;
		},
		getLegendName(l) {
			if (l in data === false) {
				l = Legend.BLANK;
			}
			// canonical slots derive their name from the active locale; custom
			// symbols keep their baked, user-supplied name.
			return localizedLegendName(l) ?? (l in s.names ? s.names[l] : debugLegendName(l));
		},
		get(l: Legend) {
			// anything not in the array is a blank.
			if (l in data === false) {
				return []; // BLANK
			}
			let s = cache.get(l);
			if (!s) {
				// need to generate this.
				s = load(l);
			}
			return s;
		},
		clone(): MutableLegendSet {
			// update the ID
			const id = crypto.randomUUID();
			return loadMutableLegends({
				id,
				name: s.name,
				names: s.names,
				shapes: s.shapes,
				font: s.font,
				sources: s.sources
			});
		},
		toJSON() {
			return s;
		},
		*[Symbol.iterator]() {
			const l = data.length;
			for (let i = 0; i < l; i++) {
				yield i;
			}
		}
	};
}

// The JSON representation of a Legend Set is basically an array of threejs ShapesJSON.
export function loadMutableLegends(s: SerialisedLegendSet): MutableLegendSet {
	// don't mutate the original array
	const data = s.shapes.slice();
	const cache = new Map<Legend, Array<Shape>>();
	const load = (l: Legend) => {
		// shapes use the project's compact encoding (shapeToJSON), the same as
		// loadImmutableLegends and the set() mutator below — not three's native
		// Shape.fromJSON format.
		const shapes = data[l].map((ss) => shapeFromJSON(ss));
		cache.set(l, shapes);
		return shapes;
	};
	const names = s.names.slice();
	const sources = (s.sources ?? []).slice();
	const set: MutableLegendSet = {
		id: s.id,
		name: s.name,
		mutable: true,
		font: s.font,
		updated: s.updated,
		get length() {
			return data.length;
		},
		getLegendName(l) {
			if (l in data === false) {
				l = Legend.BLANK;
			}
			// canonical slots derive their name from the active locale; custom
			// symbols keep their baked, user-supplied name.
			return localizedLegendName(l) ?? (l in names ? names[l] : debugLegendName(l));
		},
		get(l: Legend) {
			// anything not in the array is a blank.
			if (l in data === false) {
				return []; // BLANK
			}
			let s = cache.get(l);
			if (!s) {
				// need to generate this.
				s = load(l);
			}
			return s;
		},
		getSource(l) {
			return sources[l] ?? undefined;
		},
		set(l, name, shapes, source) {
			cache.set(l, shapes);
			data[l] = shapes.map(shapeToJSON);
			names[l] = name;
			if (source !== undefined) {
				sources[l] = source;
			}
		},
		setSerialized(l, name, shapes, source) {
			cache.delete(l); // will be re-decoded from `data` on next get()
			data[l] = shapes as Array<any>;
			names[l] = name;
			if (source !== undefined) {
				sources[l] = source;
			}
		},
		toJSON() {
			// Read the mutable scalars off `this` rather than the captured `set`.
			// When this set is wrapped in a Svelte $state proxy (the editor),
			// assignments like `set.name = …` update the proxy's signals but NOT
			// the underlying target object, so the closure's `set.name` would be
			// stale. `this` resolves through the proxy (or the plain instance when
			// called directly), so it always sees the latest value.
			const self = this as MutableLegendSet;
			return {
				id: s.id,
				name: self.name,
				names: names,
				shapes: data,
				updated: self.updated,
				font: self.font,
				sources: sources
			};
		},
		*[Symbol.iterator]() {
			const l = data.length;
			for (let i = 0; i < l; i++) {
				yield i;
			}
		}
	};
	return set;
}
