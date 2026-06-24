// A D24 modelled as a deltoidal icositetrahedron - the Dice Lab d24 design and
// the most attractive icositetrahedron with parallel opposing faces. It is the
// Catalan dual of the rhombicuboctahedron; its 24 faces are congruent kites.

import type { DieModel } from '$lib/interfaces/dice';
import { convexPolyhedronDie, dualVertices, signs } from '$lib/utils/convex_polyhedra';
import { pickForNumberLarge } from '$lib/utils/legends';
import { Vector3 } from 'three';

// rhombicuboctahedron: all permutations of (+/-1, +/-1, +/-(1+sqrt2)).
function rhombicuboctahedronVertices(): Array<Vector3> {
	const t = 1 + Math.SQRT2;
	return [...signs(t, 1, 1), ...signs(1, t, 1), ...signs(1, 1, t)];
}

export const DeltoidalIcositetrahedronD24: DieModel = convexPolyhedronDie({
	id: 'deltoidal_icositetrahedron_d24',
	name: 'D24 Deltoidal',
	vertices: () => dualVertices(rhombicuboctahedronVertices()),
	defaultSize: 22,
	minSize: 16,
	numbering: (i) => pickForNumberLarge(i),
	individualLegendScaling: true
});
