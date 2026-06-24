// A chiral "skew" D12 - the Dice Lab Skew d12 design, based on the tetartoid
// (a.k.a. pentagon-tritetrahedron / tetragonal pentagonal dodecahedron). It is
// a distortion of the regular dodecahedron with chiral tetrahedral symmetry: 12
// congruent irregular pentagons. Being isohedral, it is exactly as fair as a
// regular d12. It comes in left/right handed mirror forms.
//
// Construction: spin a single seed point through the chiral tetrahedral group T
// (order 12) to get a 12-vertex, vertex-transitive "snub tetrahedron" (an
// irregular icosahedron). Its polar dual is face-transitive (isohedral) with 12
// pentagonal faces - the tetartoid.

import type { DieModel } from '$lib/interfaces/dice';
import { PHI, convexPolyhedronDie } from '$lib/utils/convex_polyhedra';
import { Vector3 } from 'three';

// seed near a regular icosahedron vertex (0, 1, phi); the off-axis x component
// breaks the mirror symmetry to give a genuine (chiral) tetartoid rather than a
// regular dodecahedron. tuned by eye for readable, clearly-skewed faces.
const SEED = new Vector3(0.35, 1, PHI);

// the 12 rotations of the chiral tetrahedral group T: the 3 cyclic coordinate
// permutations combined with the 4 sign patterns having an even number of
// minus signs.
const SIGN_PATTERNS: Array<[number, number, number]> = [
	[1, 1, 1],
	[1, -1, -1],
	[-1, 1, -1],
	[-1, -1, 1]
];

function tetrahedralOrbit(): Array<Vector3> {
	const out: Array<Vector3> = [];
	for (const [sx, sy, sz] of SIGN_PATTERNS) {
		const q = new Vector3(SEED.x * sx, SEED.y * sy, SEED.z * sz);
		out.push(new Vector3(q.x, q.y, q.z));
		out.push(new Vector3(q.z, q.x, q.y));
		out.push(new Vector3(q.y, q.z, q.x));
	}
	return out;
}

// the die is the polar dual of this snub tetrahedron; its 12 pentagonal faces,
// single shape and chiral tetrahedral symmetry are derived from the source. the
// left/right mirror is produced by the chiral `handedness` parameter.
export const TetartoidD12: DieModel = convexPolyhedronDie({
	id: 'tetartoid_d12',
	name: 'D12 Skew',
	source: tetrahedralOrbit,
	defaultSize: 18,
	minSize: 10,
	individualLegendScaling: true,
	chiral: true
});
