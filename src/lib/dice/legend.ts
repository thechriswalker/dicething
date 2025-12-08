// a "pseudo-dice" that is for creating legends.
// it is a non-manifold dice, that has a single square face.

import type { DieModel } from '$lib/interfaces/dice';
import { Transform } from '$lib/utils/3d';
import { Legend } from '$lib/utils/legends';
import { Shape, Vector2 } from 'three';

const x = 20;
const square = new Shape([
	new Vector2(-x, x),
	new Vector2(x, x),
	new Vector2(x, -x),
	new Vector2(-x, -x)
]);
const identityTransform = new Transform();

export const legendTester: DieModel = {
	id: 'legend',
	name: 'Square',
	parameters: [],
	build() {
		return {
			faceToFaceDistance: 0,
			faceToEdgeDistance: 1.5,
			faces: [
				{
					defaultLegend: Legend.DOUBLE_ZERO,
					shape: square,
					isNumberFace: true,
					transform: identityTransform
				}
			],
			printingTransform: identityTransform
		};
	},
	blankParameters(params, offset) {
		return params;
	}
};
