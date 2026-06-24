// A D60 modelled as a pentakis dodecahedron (a dodecahedron with a shallow
// pyramid on each pentagonal face). It is the Catalan dual of the truncated
// icosahedron (the "soccer ball"); its 60 faces are congruent isosceles
// triangles.

import type { DieModel } from '$lib/interfaces/dice';
import { PHI, convexPolyhedronDie, dualVertices, evenPerms, signs } from '$lib/utils/convex_polyhedra';
import { pickForNumberLarge } from '$lib/utils/legends';
import { Vector3 } from 'three';

// truncated icosahedron: even permutations of (0, +/-1, +/-3phi),
// (+/-1, +/-(2+phi), +/-2phi) and (+/-phi, +/-2, +/-(2phi+1)).
function truncatedIcosahedronVertices(): Array<Vector3> {
	const phi = PHI;
	const out: Array<Vector3> = [];
	for (const [a, b, c] of evenPerms(0, 1, 3 * phi)) {
		out.push(...signs(a, b, c));
	}
	for (const [a, b, c] of evenPerms(1, 2 + phi, 2 * phi)) {
		out.push(...signs(a, b, c));
	}
	for (const [a, b, c] of evenPerms(phi, 2, 2 * phi + 1)) {
		out.push(...signs(a, b, c));
	}
	return out;
}

export const PentakisDodecahedronD60: DieModel = convexPolyhedronDie({
	id: 'pentakis_dodecahedron_d60',
	name: 'D60 Pentakis',
	vertices: () => dualVertices(truncatedIcosahedronVertices()),
	defaultSize: 30,
	minSize: 22,
	maxSize: 80,
	numbering: (i) => pickForNumberLarge(i),
	individualLegendScaling: true
});
