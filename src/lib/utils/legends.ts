import { Shape } from 'three';
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
	// and 34 slots for custom stuff..
	CUSTOM_SYMBOLS_START = 32
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
export type LegendFontOrigin =
	| { kind: 'builtin'; builtinId: string }
	| { kind: 'uploaded' };

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
	// classification tags (e.g. "std", "0-99") so custom sets can be filtered
	// alongside builtins, e.g. in the preset legend picker.
	readonly tags: Array<string>;
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
	// classification tags (e.g. "std", "0-99").
	tags?: Array<string>;
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
		tags: s.tags ?? [],
		get length() {
			return data.length;
		},
		getLegendName(l) {
			if (l in data === false) {
				l = Legend.BLANK;
			}
			return l in s.names ? s.names[l] : debugLegendName(l);
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
				sources: s.sources,
				tags: s.tags
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
	const tags = (s.tags ?? []).slice();
	const set: MutableLegendSet = {
		id: s.id,
		name: s.name,
		mutable: true,
		tags,
		font: s.font,
		updated: s.updated,
		get length() {
			return data.length;
		},
		getLegendName(l) {
			if (l in data === false) {
				l = Legend.BLANK;
			}
			return l in names ? names[l] : debugLegendName(l);
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
				sources: sources,
				tags: tags
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
