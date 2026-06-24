// A D24 modelled as a tetrakis hexahedron (a cube with a shallow pyramid on
// each face). It is the Catalan dual of the truncated octahedron; its 24 faces
// are congruent (wide, short) isosceles triangles.

import type { DieModel } from '$lib/interfaces/dice';
import { allPerms, convexPolyhedronDie, signs } from '$lib/utils/convex_polyhedra';
import { pickForNumberLarge } from '$lib/utils/legends';
import { Vector3 } from 'three';

// truncated octahedron: all permutations of (0, +/-1, +/-2).
function truncatedOctahedronVertices(): Array<Vector3> {
	return allPerms(0, 1, 2).flatMap(([a, b, c]) => signs(a, b, c));
}

export const TetrakisHexahedronD24: DieModel = convexPolyhedronDie({
	id: 'tetrakis_hexahedron_d24',
	name: 'D24 Tetrakis',
	source: truncatedOctahedronVertices,
	defaultSize: 22,
	minSize: 16,
	seedRotation: 180,
	numbering: (i) => pickForNumberLarge(i),
	individualLegendScaling: true
});
