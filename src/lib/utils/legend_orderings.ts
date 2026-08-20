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
//   - 'standard': the baseline (units 0–9 on a d10).
//   - 'custom':   the user has hand-edited legends, so every effective legend
//                 is stored explicitly in `face_parameters` instead.
//
// Ten-sided dice also offer 'percentile' (00–90). Legacy d00_* kinds are
// migrated to d10_* + percentile on load (see die_migrate.ts); display names
// follow via die_display_name.ts.

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

function goFirstOrdering(id: string): LegendOrdering {
	const values = GO_FIRST_VALUES[id].map((v) => legendForValue(v));
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
// Percentile on every 10-sided die; Spindown when authored; Go First on d12s.
export function getOrderings(kind: string): Array<LegendOrdering> {
	const model = dice[kind as keyof typeof dice];
	const sides = model?.tags?.sides;
	const isTenSided = sides === '10' || sides === '00';
	const orderings: Array<LegendOrdering> = [
		standardOrdering(isTenSided ? 'standard_d10' : STANDARD_ORDERING)
	];
	if (!model) {
		return orderings;
	}
	if (isTenSided) {
		orderings.push(percentileOrdering());
	}
	if (kind in spindownOrders) {
		orderings.push(spindownOrdering(kind));
	}
	if (sides === '12') {
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
