// Bounds-only engraving check: does each legend fit on its face?
//
// This is the same fit test `canEngraveLegend` runs during a full build, without
// constructing meshes or a Manifold solid. The editor uses it to badge every die
// in a set from a worker that is not the viewport.

import dice from '$lib/dice';
import type { Dice } from '$lib/interfaces/storage.svelte';
import type { EngravingError } from './builder';
import { applyOrderingToFaces, STANDARD_ORDERING } from './legend_orderings';
import { getOrComputeLegendScaling } from './legend_scaling_cache';
import { Legend, type LegendSet } from './legends';
import { isContained, rotateShapes, scaleShapes, translateShapes } from './shapes';
import type { Shape } from 'three';

function legendFits(
	surface: Shape,
	symbols: Array<Shape>,
	orientation: { scale?: number; rotation?: number; offset?: { x: number; y: number; lengthSq?: () => number } },
	clearance: number,
	convex: boolean
): boolean {
	let oriented = symbols;
	if (orientation.scale && orientation.scale !== 1) {
		oriented = scaleShapes(orientation.scale, ...oriented);
	}
	if (orientation.rotation) {
		oriented = rotateShapes(orientation.rotation, ...oriented);
	}
	const offset = orientation.offset;
	if (offset && typeof offset.lengthSq === 'function' && offset.lengthSq() !== 0) {
		oriented = translateShapes(offset as import('three').Vector2, ...oriented);
	}
	return isContained(surface, oriented, clearance, convex);
}

// Mirrors builder.resolveIndividualLegendScaling. Kept here so this module does
// not pull the Manifold engraver into the bounds-check worker.
function individualScaling(modelPrefersIndividual: boolean, mode: number | undefined): boolean {
	const m = mode ?? 0;
	if (m === 1) return true;
	if (m === 2) return false;
	return modelPrefersIndividual;
}

export function computeEngravingBoundsErrors(die: Dice, legends: LegendSet): Array<EngravingError> {
	const model = dice[die.kind];
	if (!model) {
		return [];
	}
	const dieParams = die.parameters;
	const stringParams = die.string_parameters ?? {};
	const ordering = die.legend_ordering ?? STANDARD_ORDERING;
	const built = model.build(dieParams, stringParams);
	applyOrderingToFaces(model.id, ordering, built.faces, dieParams);
	const tolerance = dieParams.engraving_tolerance ?? 0.5;
	const individual = individualScaling(!!built.sizeLegendsIndividually, dieParams.legend_scaling_mode);
	const scaling = getOrComputeLegendScaling({
		modelId: model.id,
		legends,
		dieParams,
		stringParams,
		ordering,
		tolerance,
		faces: built.faces,
		faceLegend: (i, face) => die.face_parameters[i]?.legend ?? face.defaultLegend
	});
	const errors: Array<EngravingError> = [];
	for (let i = 0; i < built.faces.length; i++) {
		const face = built.faces[i];
		if (face.hidden) {
			continue;
		}
		const fp = die.face_parameters[i];
		const legend = fp?.legend ?? face.defaultLegend;
		if (legend === Legend.BLANK) {
			continue;
		}
		const symbols = legends.get(legend);
		if (symbols.length === 0) {
			continue;
		}
		const auto = individual
			? (scaling.perLegend.get(legend) ?? scaling.smallest)
			: scaling.smallest;
		const scale = fp?.scale ? fp.scale : auto;
		if (
			!legendFits(
				face.shape,
				symbols,
				{ scale, rotation: fp?.rotation, offset: fp?.offset },
				tolerance,
				face.convex !== false
			)
		) {
			errors.push({
				faceIndex: i,
				legend,
				legendName: legends.getLegendName(legend),
				reason: 'symbol-too-large'
			});
		}
	}
	return errors;
}
