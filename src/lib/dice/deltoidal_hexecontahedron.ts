// A D60 modelled as a deltoidal hexecontahedron - the Dice Lab d60 design. It
// is the Catalan dual of the rhombicosidodecahedron; its 60 faces are congruent
// kites.

import type { DieModel } from '$lib/interfaces/dice';
import { PHI, convexPolyhedronDie, dualVertices, evenPerms, signs } from '$lib/utils/convex_polyhedra';
import { pickForNumberLarge } from '$lib/utils/legends';
import { Vector3 } from 'three';

// rhombicosidodecahedron: even permutations of (+/-1, +/-1, +/-phi^3),
// (+/-phi^2, +/-phi, +/-2phi) and (+/-(2+phi), 0, +/-phi^2).
function rhombicosidodecahedronVertices(): Array<Vector3> {
	const phi = PHI;
	const phi2 = phi * phi;
	const phi3 = 2 * phi + 1;
	const out: Array<Vector3> = [];
	for (const [a, b, c] of evenPerms(1, 1, phi3)) {
		out.push(...signs(a, b, c));
	}
	for (const [a, b, c] of evenPerms(phi2, phi, 2 * phi)) {
		out.push(...signs(a, b, c));
	}
	for (const [a, b, c] of evenPerms(2 + phi, 0, phi2)) {
		out.push(...signs(a, b, c));
	}
	return out;
}

export const DeltoidalHexecontahedronD60: DieModel = convexPolyhedronDie({
	id: 'deltoidal_hexecontahedron_d60',
	name: 'D60 Deltoidal',
	vertices: () => dualVertices(rhombicosidodecahedronVertices()),
	defaultSize: 30,
	minSize: 22,
	maxSize: 80,
	numbering: (i) => pickForNumberLarge(i),
	individualLegendScaling: true
});
