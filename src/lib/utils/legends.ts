import { Shape } from 'three';
import { toJSON } from './to_json';

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
	// and 34 slots for custom stuff..
	CUSTOM_SYMBOLS_START = 31
}

// a custom legend
export function CustomLegend(x: number): Legend {
	if (!Number.isInteger(x) || x < 0) {
		console.error('CustomLegend index invalid', x);
		throw new Error('CustomLegend index must be a positive integer');
	}
	return Legend.CUSTOM_SYMBOLS_START + x;
}

// array of text to use for each legend when creating from a font.
const legendText =
	'0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 6. 9. 30 40 50 60 70 80 90 00'.split(' ');

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

// this is a boring function, but useful for debugging...
export function debugLegendName(n: Legend): string {
	switch (n) {
		case Legend.BLANK:
			return 'BLANK';
		case Legend.ZERO:
			return 'ZERO';
		case Legend.ONE:
			return 'ONE';
		case Legend.TWO:
			return 'TWO';
		case Legend.THREE:
			return 'THREE';
		case Legend.FOUR:
			return 'FOUR';
		case Legend.FIVE:
			return 'FIVE';
		case Legend.SIX:
			return 'SIX';
		case Legend.SEVEN:
			return 'SEVEN';
		case Legend.EIGHT:
			return 'EIGHT';
		case Legend.NINE:
			return 'NINE';
		case Legend.TEN:
			return 'TEN';
		case Legend.ELEVEN:
			return 'ELEVEN';
		case Legend.TWELVE:
			return 'TWELVE';
		case Legend.THIRTEEN:
			return 'THIRTEEN';
		case Legend.FOURTEEN:
			return 'FOURTEEN';
		case Legend.FIFTEEN:
			return 'FIFTEEN';
		case Legend.SIXTEEN:
			return 'SIXTEEN';
		case Legend.SEVENTEEN:
			return 'SEVENTEEN';
		case Legend.EIGHTEEN:
			return 'EIGHTEEN';
		case Legend.NINETEEN:
			return 'NINETEEN';
		case Legend.TWENTY:
			return 'TWENTY';
		case Legend.SIX_MARKED:
			return 'SIX_MARKED';
		case Legend.NINE_MARKED:
			return 'NINE_MARKED';
		case Legend.THIRTY:
			return 'THIRTY';
		case Legend.FORTY:
			return 'FORTY';
		case Legend.FIFTY:
			return 'FIFTY';
		case Legend.SIXTY:
			return 'SIXTY';
		case Legend.SEVENTY:
			return 'SEVENTY';
		case Legend.EIGHTY:
			return 'EIGHTY';
		case Legend.NINETY:
			return 'NINETY';
		case Legend.DOUBLE_ZERO:
			return 'DOUBLE_ZERO';
	}
	return `CUSTOM_SYMBOL_(${n})`;
}

export type LegendSet = {
	get(l: Legend): Array<Shape>;
	toJSON(): any;
};

// a legend set that the user can update.
// need to use it to add "custom" legends
// to an existing font.
export type MutableLegendSet = LegendSet & {
	set(l: Legend, shapes: Array<Shape>): void;
};

// all blanks
export function blanks(): LegendSet {
	return {
		get() {
			return [];
		},
		toJSON() {
			return [];
		}
	};
}

// The JSON representation of a Legend Set is basically an array of threejs ShapesJSON.
export function loadLegends(obj: Array<Array<any>>, preload = false): MutableLegendSet {
	// don't mutate the original array
	const data = obj.slice();
	const cache = new Map<Legend, Array<Shape>>();
	const load = (l: Legend) => {
		const shapes = data[l].map((ss) => new Shape().fromJSON(ss));
		cache.set(l, shapes);
		return shapes;
	};
	if (preload) {
		for (let i = 0; i < data.length; i++) {
			load(i);
		}
	}
	return {
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
		set(l, shapes) {
			cache.set(l, shapes);
			data[l] = toJSON(shapes);
		},
		toJSON() {
			return data;
		}
	};
}
