// Legend orderings: per-die-kind rules that redefine the DEFAULT legend of each
// number face.
//
// Every render/build/export path resolves a face's legend as
// `faceParams.legend ?? face.defaultLegend`. An "ordering" is therefore just a
// function that rewrites the `defaultLegend` of the number faces produced by
// `DieModel.build()`. "Standard" is whatever the model already produces; the
// other orderings rearrange (or relabel) the number faces.
//
// A die's chosen ordering id lives on `Dice.legend_ordering`. Two ids are
// special and apply NO override (the model's standard defaults stand):
//   - 'standard': the baseline (units 0–9 on a d10; Bosch layout on regular /
//                 skew d12s).
//   - 'custom':   the user has hand-edited legends, so every effective legend
//                 is stored explicitly in `face_parameters` instead.
//
// Ten-sided dice also offer 'percentile' (00–90). Legacy d00_* kinds are
// migrated to d10_* + percentile on load (see die_migrate.ts); display names
// follow via die_display_name.ts.
//
// Regular and skew d12s also offer 'dicething' (evens around 1) and 'chessex'
// (lows around 1) as alternatives to the Bosch standard.

import type { DieFaceModel } from '$lib/interfaces/dice';
import dice from '$lib/dice';
import { spindownOrders } from '$lib/utils/spindown_orders';
import { Legend, legendForValue, pickForDoublesByIndex } from '$lib/utils/legends';

export type LegendOrdering = {
	// stable id, stored on `Dice.legend_ordering`.
	id: string;
	// i18n key for the dropdown label, looked up via m.legend_ordering_option().
	labelKey: string;
	// the default legend for each face. length === faces.length. non-number
	// faces keep their existing default; number faces are (re)assigned in their
	// standard build order.
	legends(faces: ReadonlyArray<DieFaceModel>, params: Record<string, number>): Array<Legend>;
};

// orderings that don't override anything (the model's standard defaults stand).
export const STANDARD_ORDERING = 'standard';
export const CUSTOM_ORDERING = 'custom';
// tens (00–90) numbering for 10-sided dice. display name reads as "D% …".
export const PERCENTILE_ORDERING = 'percentile';
// legacy id from when d00_* instances offered an explicit units switch. still
// recognised by migration (→ standard on d10); no longer offered in the UI.
export const UNITS_ORDERING = 'units';

// Go First number sets keyed by die sides, then ordering id. Values are
// assigned in order to the die's number faces. Shared with the go_first preset.
// Sources: https://en.wikipedia.org/wiki/Go_First_Dice
//   6  → 3-player (Robert Ford, 2010)
//   12 → 4-player (Robert Ford, 2010)
//   60 → 5-player (Paul Meyer, 2023); needs five_player_voltaire for 100–300
const GO_FIRST_VALUES: Record<string, Record<string, Array<number>>> = {
	'6': {
		go_first_a: [1, 5, 10, 11, 13, 17],
		go_first_b: [3, 4, 7, 12, 15, 16],
		go_first_c: [2, 6, 8, 9, 14, 18]
	},
	'12': {
		go_first_a: [1, 8, 11, 14, 19, 22, 27, 30, 35, 38, 41, 48],
		go_first_b: [2, 7, 10, 15, 18, 23, 26, 31, 34, 39, 42, 47],
		go_first_c: [3, 6, 12, 13, 17, 24, 25, 32, 36, 37, 43, 46],
		go_first_d: [4, 5, 9, 16, 20, 21, 28, 29, 33, 40, 44, 45]
	},
	'60': {
		go_first_a: [
			1, 10, 19, 20, 21, 22, 39, 40, 41, 42, 51, 60, 61, 62, 71, 80, 81, 90, 99, 100, 109, 118,
			119, 120, 121, 122, 123, 132, 133, 150, 151, 168, 169, 178, 179, 180, 181, 182, 183, 192,
			201, 202, 211, 220, 221, 230, 239, 240, 241, 250, 259, 260, 261, 262, 279, 280, 281, 282,
			291, 300
		],
		go_first_b: [
			2, 9, 13, 16, 25, 28, 33, 36, 45, 48, 52, 59, 65, 68, 72, 79, 85, 86, 94, 95, 101, 108,
			112, 115, 126, 129, 134, 141, 145, 146, 155, 156, 160, 167, 172, 175, 187, 188, 196, 197,
			203, 210, 212, 219, 225, 226, 234, 235, 244, 247, 251, 258, 266, 267, 274, 275, 283, 290,
			294, 297
		],
		go_first_c: [
			3, 8, 12, 17, 24, 29, 32, 37, 44, 49, 53, 58, 64, 69, 73, 78, 83, 88, 92, 97, 102, 107,
			111, 116, 125, 130, 135, 140, 143, 148, 153, 158, 161, 166, 171, 176, 185, 190, 194, 199,
			204, 209, 213, 218, 223, 228, 232, 237, 243, 248, 252, 257, 264, 269, 272, 277, 284, 289,
			293, 298
		],
		go_first_d: [
			4, 7, 11, 18, 26, 27, 34, 35, 43, 50, 54, 57, 63, 70, 74, 77, 84, 87, 93, 96, 103, 106,
			110, 117, 127, 128, 137, 138, 142, 149, 152, 159, 163, 164, 173, 174, 184, 191, 195, 198,
			205, 208, 214, 217, 224, 227, 231, 238, 245, 246, 254, 255, 263, 270, 271, 278, 286, 287,
			295, 296
		],
		go_first_e: [
			5, 6, 14, 15, 23, 30, 31, 38, 46, 47, 55, 56, 66, 67, 75, 76, 82, 89, 91, 98, 104, 105,
			113, 114, 124, 131, 136, 139, 144, 147, 154, 157, 162, 165, 170, 177, 186, 189, 193, 200,
			206, 207, 215, 216, 222, 229, 233, 236, 242, 249, 253, 256, 265, 268, 273, 276, 285, 288,
			292, 299
		]
	}
};

// Regular / skew d12 face-layout orderings, indexed by number-face position in
// the die's *standard* (Bosch) build/explode order. Both d12_dodecahedron and
// d12_tetartoid use that same standard, so one table covers both.
//
// - dicething: historic dicething layout — 1 surrounded by evens, 12 by odds.
// - chessex:   common commercial layout (Alea Kybos d12_1 / Chessex): 2..6
//              clockwise around 1 (so lows cluster around 1, highs around 12).
const D12_LAYOUT_KINDS = new Set(['d12_dodecahedron', 'd12_tetartoid']);
const D12_LAYOUT_VALUES: Record<string, Array<number>> = {
	dicething: [1, 3, 11, 5, 9, 7, 6, 4, 8, 2, 10, 12],
	chessex: [1, 8, 11, 10, 9, 7, 6, 4, 3, 2, 5, 12]
};

// the build-order indices of the number faces.
function numberFaceIndices(faces: ReadonlyArray<DieFaceModel>): Array<number> {
	const out: Array<number> = [];
	for (let i = 0; i < faces.length; i++) {
		if (faces[i].isNumberFace) {
			out.push(i);
		}
	}
	return out;
}

// start from the standard defaults, then assign `values[k]` to the k-th number
// face. when `values` doesn't cover every number face, the uncovered faces keep
// their standard default (so the ordering degrades gracefully).
function assignToNumberFaces(
	faces: ReadonlyArray<DieFaceModel>,
	values: ReadonlyArray<Legend>
): Array<Legend> {
	const result = faces.map((f) => f.defaultLegend);
	const idx = numberFaceIndices(faces);
	if (values.length !== idx.length) {
		// length mismatch: don't trust a partial mapping, fall back to standard.
		return result;
	}
	for (let k = 0; k < idx.length; k++) {
		result[idx[k]] = values[k];
	}
	return result;
}

function standardOrdering(labelKey: string = STANDARD_ORDERING): LegendOrdering {
	return {
		id: STANDARD_ORDERING,
		labelKey,
		legends: (faces) => faces.map((f) => f.defaultLegend)
	};
}

function spindownOrdering(kind: string): LegendOrdering {
	return {
		id: 'spindown',
		labelKey: 'spindown',
		legends: (faces) => assignToNumberFaces(faces, spindownOrders[kind] ?? [])
	};
}

function goFirstOrdering(sides: string, id: string): LegendOrdering {
	const values = GO_FIRST_VALUES[sides][id].map((v) => legendForValue(v));
	return {
		id,
		labelKey: id,
		legends: (faces) => assignToNumberFaces(faces, values)
	};
}

function d12LayoutOrdering(id: string): LegendOrdering {
	const values = D12_LAYOUT_VALUES[id].map((v) => legendForValue(v));
	return {
		id,
		labelKey: id,
		legends: (faces) => assignToNumberFaces(faces, values)
	};
}

// 00/10/20…90 on the number faces, in build order.
function percentileOrdering(): LegendOrdering {
	return {
		id: PERCENTILE_ORDERING,
		labelKey: 'standard_percentile',
		legends: (faces) => {
			const n = numberFaceIndices(faces).length;
			const values = Array.from({ length: n }, (_, i) => pickForDoublesByIndex(i));
			return assignToNumberFaces(faces, values);
		}
	};
}

// the orderings offered for a given die kind. Standard is always first;
// Percentile on every 10-sided die; Spindown when authored; Go First on
// 6 / 12 / 60-sided dice. Regular/skew d12s also offer Dicething and Chessex
// face layouts (standard is Bosch).
export function getOrderings(kind: string): Array<LegendOrdering> {
	const model = dice[kind as keyof typeof dice];
	const sides = model?.tags?.sides;
	const isTenSided = sides === '10' || sides === '00';
	const isBoschD12 = D12_LAYOUT_KINDS.has(kind);
	const orderings: Array<LegendOrdering> = [
		standardOrdering(
			isTenSided ? 'standard_d10' : isBoschD12 ? 'standard_bosch' : STANDARD_ORDERING
		)
	];
	if (!model) {
		return orderings;
	}
	if (isTenSided) {
		orderings.push(percentileOrdering());
	}
	if (isBoschD12) {
		for (const id of Object.keys(D12_LAYOUT_VALUES)) {
			orderings.push(d12LayoutOrdering(id));
		}
	}
	if (kind in spindownOrders) {
		orderings.push(spindownOrdering(kind));
	}
	const goFirst = sides ? GO_FIRST_VALUES[sides] : undefined;
	if (goFirst) {
		for (const id of Object.keys(goFirst)) {
			orderings.push(goFirstOrdering(sides!, id));
		}
	}
	return orderings;
}

// resolve a single ordering by id (or undefined for unknown/standard/custom).
export function resolveOrdering(kind: string, id: string | undefined): LegendOrdering | undefined {
	if (!id || id === STANDARD_ORDERING || id === CUSTOM_ORDERING) {
		return undefined;
	}
	return getOrderings(kind).find((o) => o.id === id);
}

// rewrite each face's `defaultLegend` in place to match the chosen ordering.
// a no-op for standard/custom/unknown ids (the model's defaults stand).
export function applyOrderingToFaces(
	kind: string,
	id: string | undefined,
	faces: Array<DieFaceModel>,
	params: Record<string, number>
): void {
	const ordering = resolveOrdering(kind, id);
	if (!ordering) {
		return;
	}
	const legends = ordering.legends(faces, params);
	for (let i = 0; i < faces.length && i < legends.length; i++) {
		faces[i].defaultLegend = legends[i];
	}
}
