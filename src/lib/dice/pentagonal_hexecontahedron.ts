// A D60 modelled as a pentagonal hexecontahedron - the chiral Catalan dual of
// the snub dodecahedron. Its 60 faces are congruent irregular pentagons, and it
// comes in two mirror-image (left/right handed) forms.

import type { DieModel } from '$lib/interfaces/dice';
import { PHI, convexPolyhedronDie, evenPerms } from '$lib/utils/convex_polyhedra';
import { pickForNumberLarge } from '$lib/utils/legends';
import { Vector3 } from 'three';

// 60 vertices of a (vertex-transitive) snub dodecahedron, built from the
// truncated icosidodecahedron's coordinate sets by sign-parity alternation.
// Vertex-transitivity guarantees the dual is face-transitive, i.e. the 60
// pentagons are congruent and the die is fair.
function snubDodecahedronPart(base: [number, number, number], oddMinus: boolean): Array<Vector3> {
	const out: Array<Vector3> = [];
	for (const [a, b, c] of evenPerms(base[0], base[1], base[2])) {
		for (let s = 0; s < 8; s++) {
			const sx = s & 1 ? -1 : 1;
			const sy = s & 2 ? -1 : 1;
			const sz = s & 4 ? -1 : 1;
			const minus = (sx < 0 ? 1 : 0) + (sy < 0 ? 1 : 0) + (sz < 0 ? 1 : 0);
			if ((minus % 2 === 1) === oddMinus) {
				out.push(new Vector3(a * sx, b * sy, c * sz));
			}
		}
	}
	return out;
}

function snubDodecahedronVertices(): Array<Vector3> {
	const phi = PHI;
	const inv = 1 / phi;
	// odd number of minus signs in these three sets:
	const odd: Array<[number, number, number]> = [
		[inv, inv, 3 + phi],
		[inv, phi * phi, 3 * phi - 1],
		[2 * phi - 1, 2, 2 + phi]
	];
	// even number of minus signs in these two sets:
	const even: Array<[number, number, number]> = [
		[2 / phi, phi, 1 + 2 * phi],
		[phi, 3, 2 * phi]
	];
	return [
		...odd.flatMap((b) => snubDodecahedronPart(b, true)),
		...even.flatMap((b) => snubDodecahedronPart(b, false))
	];
}

// the die is the polar dual of this snub dodecahedron; its 60 pentagonal faces,
// single shape and chiral icosahedral symmetry are derived from the source. the
// left/right mirror is produced by the chiral `handedness` parameter.
export const PentagonalHexecontahedronD60: DieModel = convexPolyhedronDie({
	id: 'd60_pentagonal_hexecontahedron',
	name: 'D60 Pentagonal',
	source: snubDodecahedronVertices,
	seedRotation: -120.5,
	defaultSize: 30,
	minSize: 22,
	maxSize: 80,
	numbering: (i) => pickForNumberLarge(i),
	individualLegendScaling: true,
	chiral: true
});
