// A D30 modelled as a rhombic triacontahedron - the Dice Lab d30 design. It is
// the Catalan dual of the icosidodecahedron; its 30 faces are congruent golden
// rhombi.

import type { DieModel } from '$lib/interfaces/dice';
import { PHI, convexPolyhedronDie, dualVertices, evenPerms, signs } from '$lib/utils/convex_polyhedra';
import { pickForNumberLarge } from '$lib/utils/legends';
import { Vector3 } from 'three';

// icosidodecahedron: permutations of (0, 0, +/-phi) plus even permutations of
// (+/-1/2, +/-phi/2, +/-phi^2/2).
function icosidodecahedronVertices(): Array<Vector3> {
	const phi = PHI;
	const out: Array<Vector3> = [...signs(phi, 0, 0), ...signs(0, phi, 0), ...signs(0, 0, phi)];
	const a = 1 / 2;
	const b = phi / 2;
	const c = (phi * phi) / 2;
	for (const [x, y, z] of evenPerms(a, b, c)) {
		out.push(...signs(x, y, z));
	}
	return out;
}

export const RhombicTriacontahedronD30: DieModel = convexPolyhedronDie({
	id: 'rhombic_triacontahedron_d30',
	name: 'D30 Rhombic',
	vertices: () => dualVertices(icosidodecahedronVertices()),
	defaultSize: 24,
	minSize: 18,
	numbering: (i) => pickForNumberLarge(i),
	individualLegendScaling: true
});
