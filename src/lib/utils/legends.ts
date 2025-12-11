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
	set(l: Legend, name: string, shapes: Array<Shape>): void;
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
			return loadMutableLegends({ id, name: s.name, names: s.names, shapes: s.shapes });
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
		const shapes = data[l].map((ss) => new Shape().fromJSON(ss));
		cache.set(l, shapes);
		return shapes;
	};
	const names = s.names.slice();
	const set: MutableLegendSet = {
		id: s.id,
		name: s.name,
		mutable: true,
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
		set(l, name, shapes) {
			cache.set(l, shapes);
			data[l] = shapes.map(shapeToJSON);
			names[l] = name;
		},
		toJSON() {
			return {
				id: s.id,
				name: set.name,
				names: names,
				shapes: data
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
