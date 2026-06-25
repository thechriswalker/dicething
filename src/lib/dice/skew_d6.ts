// A chiral "skew" D6 - the Dice Lab Skew Dice design, based on a distorted
// trigonal trapezohedron. Its six faces are congruent (but irregular)
// quadrilaterals, and the solid is isohedral, so despite the bizarre look it is
// exactly as fair as a cube. It comes in left/right handed mirror forms.
//
// Construction: take a single seed point and spin it through the chiral group
// D3 (a 3-fold axis plus three perpendicular 2-fold axes) to get a 6-vertex,
// vertex-transitive trigonal antiprism. The polar dual of a vertex-transitive
// solid is face-transitive (isohedral), and the dual of a trigonal antiprism is
// the trigonal trapezohedron - our die.

import type { DieModel } from '$lib/interfaces/dice';
import { convexPolyhedronDie } from '$lib/utils/convex_polyhedra';
import { Vector3 } from 'three';

const zAxis = new Vector3(0, 0, 1);

// the seed point is (1, skew, height). Its off-axis "skew" (y) component is the
// twist between the antiprism's two triangles, and so the amount of skew in the
// die: smaller is more bipyramid-like, larger shears the faces further over.
// (At y = 0 the two triangles line up into a non-chiral prism.) The x and height
// are fixed; the default is tuned by eye for a chunky, clearly-skewed-but-
// readable die.
const SEED_X = 1;
const SEED_HEIGHT = 0.62;
const SKEW_PARAM = 'skew';
const DEFAULT_SKEW = 0.45;

// the 6-vertex D3 orbit of the seed: the three C3 rotations about z, each also
// taken through the 2-fold rotation about x ((x,y,z) -> (x,-y,-z)).
function antiprismVertices(params: Record<string, number>): Array<Vector3> {
	const skew = params[SKEW_PARAM] ?? DEFAULT_SKEW;
	const seed = new Vector3(SEED_X, skew, SEED_HEIGHT);
	const out: Array<Vector3> = [];
	for (let k = 0; k < 3; k++) {
		const u = seed.clone().applyAxisAngle(zAxis, (k * 2 * Math.PI) / 3);
		out.push(u.clone());
		out.push(new Vector3(u.x, -u.y, -u.z));
	}
	return out;
}

// the die is the polar dual of this antiprism; its faces, single shape and
// trapezohedral (D3) symmetry are all derived from the source. the left/right
// mirror is produced by the chiral `handedness` parameter.
export const SkewD6: DieModel = convexPolyhedronDie({
	id: 'd6_skew',
	name: 'D6 Skew',
	source: antiprismVertices,
	defaultSize: 16,
	minSize: 8,
	chiral: true,
	// how far the faces shear over (the antiprism twist).
	extraParameters: [{ id: SKEW_PARAM, defaultValue: DEFAULT_SKEW, min: 0.2, max: 0.9, step: 0.01 }]
});
