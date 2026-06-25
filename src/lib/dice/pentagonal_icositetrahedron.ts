// A D24 modelled as a pentagonal icositetrahedron - the chiral Catalan dual of
// the snub cube. Its 24 faces are congruent irregular pentagons, and the solid
// comes in two mirror-image (left/right handed) forms.

import type { DieModel } from '$lib/interfaces/dice';
import { TRIBONACCI, convexPolyhedronDie, snubVertices } from '$lib/utils/convex_polyhedra';
import { pickForNumberLarge } from '$lib/utils/legends';
import { Vector3 } from 'three';

// snub cube: even/odd permutation + sign selection of (1, 1/t, t), t = tribonacci.
function snubCubeVertices(): Array<Vector3> {
	const t = TRIBONACCI;
	return snubVertices([1, 1 / t, t]);
}

// the die is the polar dual of this snub cube; its 24 pentagonal faces, single
// shape and chiral octahedral symmetry are derived from the source. the
// left/right mirror is produced by the chiral `handedness` parameter.
export const PentagonalIcositetrahedronD24: DieModel = convexPolyhedronDie({
	id: 'd24_pentagonal_icositetrahedron',
	name: 'D24 Pentagonal',
	source: snubCubeVertices,
	defaultSize: 22,
	minSize: 16,
	seedRotation: 118.5,
	numbering: (i) => pickForNumberLarge(i),
	individualLegendScaling: true,
	chiral: true
});
