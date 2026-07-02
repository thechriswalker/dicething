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
//   - 'standard': the baseline.
//   - 'custom':   the user has hand-edited legends, so every effective legend
//                 is stored explicitly in `face_parameters` instead.

import type { DieFaceModel } from '$lib/interfaces/dice';
import dice from '$lib/dice';
import { spindownOrders } from '$lib/utils/spindown_orders';
import { Legend, legendForValue } from '$lib/utils/legends';

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

// the Go First number sets (4 players' worth of d12s), one per ordering. Each
// is assigned, in order, to a d12's 12 number faces. Mirrors the historic
// go_first preset; kept here so the preset and the per-die ordering share one
// source of truth.
const GO_FIRST_VALUES: Record<string, Array<number>> = {
	go_first_a: [1, 8, 11, 14, 19, 22, 27, 30, 35, 38, 41, 48],
	go_first_b: [2, 7, 10, 15, 18, 23, 26, 31, 34, 39, 42, 47],
	go_first_c: [3, 6, 12, 13, 17, 24, 25, 32, 36, 37, 43, 46],
	go_first_d: [4, 5, 9, 16, 20, 21, 28, 29, 33, 40, 44, 45]
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

function standardOrdering(): LegendOrdering {
	return {
		id: STANDARD_ORDERING,
		labelKey: STANDARD_ORDERING,
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

function goFirstOrdering(id: string): LegendOrdering {
	const values = GO_FIRST_VALUES[id].map((v) => legendForValue(v));
	return {
		id,
		labelKey: id,
		legends: (faces) => assignToNumberFaces(faces, values)
	};
}

// the orderings offered for a given die kind. Standard is always first;
// Spindown only when this die has an authored entry in `spindownOrders`
// (caltrops and other shapes that are already "spindown-like" by default
// are omitted); the four Go First arrangements are offered for every
// 12-sided die.
export function getOrderings(kind: string): Array<LegendOrdering> {
	const model = dice[kind as keyof typeof dice];
	const orderings: Array<LegendOrdering> = [standardOrdering()];
	if (!model) {
		return orderings;
	}
	if (kind in spindownOrders) {
		orderings.push(spindownOrdering(kind));
	}
	if (model.tags?.sides === '12') {
		for (const id of Object.keys(GO_FIRST_VALUES)) {
			orderings.push(goFirstOrdering(id));
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
