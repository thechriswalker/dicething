// A D24 modelled as a pentagonal icositetrahedron - the chiral Catalan dual of
// the snub cube. Its 24 faces are congruent irregular pentagons, and the solid
// comes in two mirror-image (left/right handed) forms.

import type { DieModel } from '$lib/interfaces/dice';
import {
	TRIBONACCI,
	convexPolyhedronDie,
	dualVertices,
	snubVertices
} from '$lib/utils/convex_polyhedra';
import { pickForNumberLarge } from '$lib/utils/legends';
import { Vector3 } from 'three';

// snub cube: even/odd permutation + sign selection of (1, 1/t, t), t = tribonacci.
function snubCubeVertices(): Array<Vector3> {
	const t = TRIBONACCI;
	return snubVertices([1, 1 / t, t]);
}

// left-handed form; the right-handed mirror image is produced by the chiral
// `handedness` parameter on the die.
function pentagonalIcositetrahedronVertices(): Array<Vector3> {
	return dualVertices(snubCubeVertices());
}

export const PentagonalIcositetrahedronD24: DieModel = convexPolyhedronDie({
	id: 'pentagonal_icositetrahedron_d24',
	name: 'D24 Pentagonal',
	vertices: pentagonalIcositetrahedronVertices,
	defaultSize: 22,
	minSize: 16,
	numbering: (i) => pickForNumberLarge(i),
	individualLegendScaling: true,
	chiral: true
});
