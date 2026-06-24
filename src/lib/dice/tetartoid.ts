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

// the seed sits near a regular icosahedron vertex (skew, 1, phi). The off-axis
// "skew" component is what breaks the mirror symmetry: at skew = 0 the seed is an
// exact icosahedron vertex and the die collapses to a regular dodecahedron;
// raising it shears the pentagons into a genuine (chiral) tetartoid. The default
// is tuned by eye for readable, clearly-skewed faces.
const SKEW_PARAM = 'skew';
const DEFAULT_SKEW = 0.35;

// the 12 rotations of the chiral tetrahedral group T: the 3 cyclic coordinate
// permutations combined with the 4 sign patterns having an even number of
// minus signs.
const SIGN_PATTERNS: Array<[number, number, number]> = [
	[1, 1, 1],
	[1, -1, -1],
	[-1, 1, -1],
	[-1, -1, 1]
];

function tetrahedralOrbit(params: Record<string, number>): Array<Vector3> {
	const skew = params[SKEW_PARAM] ?? DEFAULT_SKEW;
	const seed = new Vector3(skew, 1, PHI);
	const out: Array<Vector3> = [];
	for (const [sx, sy, sz] of SIGN_PATTERNS) {
		const q = new Vector3(seed.x * sx, seed.y * sy, seed.z * sz);
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
	chiral: true,
	// how far the faces shear away from a regular dodecahedron.
	extraParameters: [{ id: SKEW_PARAM, defaultValue: DEFAULT_SKEW, min: 0.1, max: 0.7, step: 0.01 }]
});
