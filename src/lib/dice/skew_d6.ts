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
import { convexPolyhedronDie, dualVertices } from '$lib/utils/convex_polyhedra';
import { Vector3 } from 'three';

const zAxis = new Vector3(0, 0, 1);

// the seed point. its off-axis y component is what skews the antiprism (and
// hence the die); with y = 0 it would collapse to a non-chiral prism. tuned by
// eye for a chunky, clearly-skewed-but-readable die.
const SEED = new Vector3(1, 0.45, 0.62);

// the 6-vertex D3 orbit of the seed: the three C3 rotations about z, each also
// taken through the 2-fold rotation about x ((x,y,z) -> (x,-y,-z)).
function antiprismVertices(): Array<Vector3> {
	const out: Array<Vector3> = [];
	for (let k = 0; k < 3; k++) {
		const u = SEED.clone().applyAxisAngle(zAxis, (k * 2 * Math.PI) / 3);
		out.push(u.clone());
		out.push(new Vector3(u.x, -u.y, -u.z));
	}
	return out;
}

// left-handed form; the right-handed mirror image is produced by the chiral
// `handedness` parameter on the die.
function skewVertices(): Array<Vector3> {
	return dualVertices(antiprismVertices());
}

export const SkewD6: DieModel = convexPolyhedronDie({
	id: 'skew_d6',
	name: 'D6 Skew',
	vertices: skewVertices,
	defaultSize: 16,
	minSize: 8,
	chiral: true
});
