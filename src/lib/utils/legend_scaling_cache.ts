import type { DieFaceModel } from '$lib/interfaces/dice';
import { Legend, type LegendSet } from './legends';
import { findBestLegendScalingFactor } from './shapes';
import type { Shape } from 'three';

export type LegendScalingResult = {
	smallest: number;
	perLegend: Map<Legend, number>;
};

const cache = new Map<string, LegendScalingResult>();

export type LegendScalingInputs = {
	modelId: string;
	legends: LegendSet;
	dieParams: Record<string, number>;
	stringParams: Record<string, string>;
	ordering: string;
	tolerance: number;
	faces: ReadonlyArray<DieFaceModel>;
	faceLegend: (index: number, face: DieFaceModel) => Legend;
};

function faceShapeSig(shape: Shape): string {
	const pts = shape.getPoints(8);
	if (pts.length === 0) {
		return 'empty';
	}
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of pts) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	return `${minX.toFixed(3)},${minY.toFixed(3)},${maxX.toFixed(3)},${maxY.toFixed(3)}`;
}

function cacheKey(inputs: LegendScalingInputs): string {
	const numberLegends: Array<Legend> = [];
	let faceShape: string | undefined;
	for (let i = 0; i < inputs.faces.length; i++) {
		const face = inputs.faces[i];
		if (face.isNumberFace) {
			numberLegends.push(inputs.faceLegend(i, face));
			faceShape ??= faceShapeSig(face.shape);
		}
	}
	numberLegends.sort((a, b) => a - b);

	return JSON.stringify({
		modelId: inputs.modelId,
		legendsId: inputs.legends.id,
		legendsUpdated: 'updated' in inputs.legends ? inputs.legends.updated : undefined,
		dieParams: inputs.dieParams,
		stringParams: inputs.stringParams,
		ordering: inputs.ordering,
		tolerance: inputs.tolerance,
		faceShape,
		numberLegends
	});
}

export function getOrComputeLegendScaling(inputs: LegendScalingInputs): LegendScalingResult {
	const key = cacheKey(inputs);
	const hit = cache.get(key);
	if (hit) {
		return hit;
	}

	const face = inputs.faces.find((x) => x.isNumberFace);
	if (!face) {
		return { smallest: 1, perLegend: new Map<Legend, number>() };
	}

	const allLegends = Array.from(
		new Set(
			inputs.faces.map((f, i) => {
				if (f.isNumberFace) {
					return inputs.faceLegend(i, f);
				}
				return Legend.BLANK;
			})
		)
	);

	let smallest = 1;
	const perLegend = new Map<Legend, number>();
	const convex = face.convex !== false;

	for (const legend of allLegends) {
		const shapes = inputs.legends.get(legend);
		if (shapes.length > 0) {
			const scale = findBestLegendScalingFactor(
				face.shape,
				shapes,
				inputs.tolerance,
				convex
			);
			perLegend.set(legend, scale);
			if (scale < smallest) {
				smallest = scale;
			}
		}
	}

	const result = { smallest, perLegend };
	cache.set(key, result);
	return result;
}

export function clearLegendScalingCache(): void {
	cache.clear();
}
