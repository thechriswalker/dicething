// Generic machinery for building dice from any convex polyhedron.
//
// The whole engine treats a die as a set of convex 2D face shapes placed in 3D
// that together tile a closed surface (see src/lib/dice/truncated_tetrahedron.ts
// for the hand-rolled version). This module generalises that: give it the 3D
// vertices of a convex solid and it derives the polygon faces (via a convex
// hull), turns each into a `DieFaceModel`, classifies number vs blank faces and
// lays out the exploded view.
//
// It also provides `dualVertices`, which reciprocates an Archimedean solid into
// its Catalan dual - so every D24/D30/D60 variant is just an Archimedean vertex
// list fed through here.

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Transform } from '$lib/utils/3d';
import { gridExplode } from '$lib/utils/explode';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices } from '$lib/utils/shapes';
import { Shape, Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

// a single (planar, convex) polygon face of a solid.
export type PolyFace = {
	// boundary vertices, ordered counter-clockwise about `normal`.
	vertices: Array<Vector3>;
	centroid: Vector3;
	normal: Vector3; // unit, outward
};

const round = (x: number, places = 4) => {
	const f = Math.pow(10, places);
	return Math.round(x * f) / f;
};

const planeKey = (normal: Vector3, constant: number): string =>
	`${round(normal.x)},${round(normal.y)},${round(normal.z)},${round(constant)}`;

const vertexKey = (v: Vector3): string => `${round(v.x, 5)},${round(v.y, 5)},${round(v.z, 5)}`;

// order coplanar vertices counter-clockwise around their centroid (in the face
// plane). winding/outward-facing is fixed later by `faceFromVertices`.
function orderAroundNormal(
	verts: Array<Vector3>,
	centroid: Vector3,
	normal: Vector3
): Array<Vector3> {
	const n = normal.clone().normalize();
	// any axis not parallel to the normal gives us an in-plane basis.
	const ref = Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
	const u = ref
		.clone()
		.sub(n.clone().multiplyScalar(ref.dot(n)))
		.normalize();
	const v = n.clone().cross(u).normalize();
	const angle = (p: Vector3) => {
		const d = p.clone().sub(centroid);
		return Math.atan2(d.dot(v), d.dot(u));
	};
	return [...verts].sort((a, b) => angle(a) - angle(b));
}

// derive the polygon faces of the convex hull of `points`. three's ConvexHull
// only emits triangles, so we merge triangles that share a plane back into the
// original polygon faces.
export function coplanarFaces(points: Array<Vector3>): Array<PolyFace> {
	const hull = new ConvexHull().setFromPoints(points);
	const groups = new Map<string, { normal: Vector3; verts: Map<string, Vector3> }>();
	for (const face of hull.faces) {
		const key = planeKey(face.normal, face.constant);
		let g = groups.get(key);
		if (!g) {
			g = { normal: face.normal.clone(), verts: new Map() };
			groups.set(key, g);
		}
		// walk the three half-edges of the triangle.
		let e = face.edge;
		do {
			const p = e.head().point as Vector3;
			const vk = vertexKey(p);
			if (!g.verts.has(vk)) {
				g.verts.set(vk, p.clone());
			}
			e = e.next;
		} while (e !== face.edge);
	}

	const faces: Array<PolyFace> = [];
	for (const g of groups.values()) {
		const verts = [...g.verts.values()];
		const centroid = verts
			.reduce((acc, v) => acc.add(v), new Vector3())
			.multiplyScalar(1 / verts.length);
		const normal = g.normal.clone().normalize();
		faces.push({ vertices: orderAroundNormal(verts, centroid, normal), centroid, normal });
	}
	return faces;
}

// reciprocate a solid (about the unit sphere) into its dual's vertices: each
// face with unit normal `n` at perpendicular distance `d = c.n` from the origin
// maps to the pole `n / d`. (Using the perpendicular distance rather than the
// centroid keeps this exact for non-uniform isogonal solids - e.g. the
// alternative snub dodecahedron - whose face centroids are off the normal.)
export function dualVertices(source: Array<Vector3>): Array<Vector3> {
	return coplanarFaces(source).map((f) => {
		const d = f.centroid.dot(f.normal);
		return f.normal.clone().multiplyScalar(1 / d);
	});
}

// mirror a vertex set through the x=0 plane, producing the opposite-handed
// chiral variant.
export function mirrorVertices(verts: Array<Vector3>): Array<Vector3> {
	return verts.map((v) => new Vector3(-v.x, v.y, v.z));
}

// build a face (shape + placement transform) from its 3D vertices, ensuring the
// engraving front (+z) ends up pointing outward (away from the origin). lifted
// from src/lib/dice/truncated_tetrahedron.ts.
function faceFromVertices(verts: Array<Vector3>): { shape: Shape; transform: Transform } {
	const centroid = verts
		.reduce((acc, v) => acc.add(v), new Vector3())
		.multiplyScalar(1 / verts.length);
	let info = orientCoplanarVertices(verts);
	if (info.normal.dot(centroid) < 0) {
		info = orientCoplanarVertices([...verts].reverse());
	}
	return {
		shape: info.shape,
		transform: new Transform().rotate(info.quat).translate(info.offset)
	};
}

export type ConvexPolyhedronOptions = {
	id: string;
	name: string;
	// the raw 3D vertices of the solid (any scale; we normalise to the size
	// parameter). centred on the origin. receives the current parameters so
	// shape-altering parameters (e.g. truncation) can rebuild the vertex set.
	vertices: (params: Record<string, number>) => Array<Vector3>;
	// size parameter bounds (face-to-face / insphere diameter in mm).
	defaultSize?: number;
	minSize?: number;
	maxSize?: number;
	sizeStep?: number;
	// classify a face as a number face by its side-count. defaults to "all
	// faces are number faces" (true for every isohedral solid).
	isNumberFace?: (sides: number) => boolean;
	// default legend for the n-th number face (in deterministic face order).
	numbering?: (numberIndex: number, numberCount: number) => Legend;
	// size each legend to its own face (needed when faces vary, or are small).
	individualLegendScaling?: boolean;
	// chiral solids expose a left/right "handedness" parameter. when set, the
	// supplied `vertices()` define the left-handed form and the right-handed
	// form is produced by mirroring across the x=0 plane.
	chiral?: boolean;
	// extra shape parameters (beyond size/handedness) surfaced on the die; their
	// values are passed back to `vertices()`.
	extraParameters?: Array<DiceParameter>;
};

const SIZE_PARAM = 'polyhedron_size';
const HANDEDNESS_PARAM = 'handedness';

// deterministic face ordering so numbering is stable: top-to-bottom, then
// around. (an optimal/balanced numbering is a possible follow-up.)
function faceSortKey(f: PolyFace): Array<number> {
	return [-round(f.centroid.y, 3), -round(f.centroid.x, 3), -round(f.centroid.z, 3)];
}

function compareKeys(a: Array<number>, b: Array<number>): number {
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return a[i] - b[i];
		}
	}
	return 0;
}

export function convexPolyhedronDie(opts: ConvexPolyhedronOptions): DieModel {
	const defaultSize = opts.defaultSize ?? 18;
	const parameters: Array<DiceParameter> = [
		{
			id: SIZE_PARAM,
			defaultValue: defaultSize,
			min: opts.minSize ?? 6,
			max: opts.maxSize ?? 60,
			step: opts.sizeStep ?? 0.5
		}
	];
	if (opts.extraParameters) {
		parameters.push(...opts.extraParameters);
	}
	// handedness is a 0 (left) / 1 (right) toggle exposed as a parameter so the
	// two mirror-image forms share a single entry in the dice list.
	if (opts.chiral) {
		parameters.push({
			id: HANDEDNESS_PARAM,
			defaultValue: 0,
			min: 0,
			max: 1,
			step: 1,
			display: {
				kind: 'toggle',
				options: [
					{ value: 0, label: 'handedness_left' },
					{ value: 1, label: 'handedness_right' }
				]
			}
		});
	}

	const isNumberFace = opts.isNumberFace ?? (() => true);
	const numbering = opts.numbering ?? ((i, n) => pickForNumber(i, n));

	return {
		id: opts.id,
		name: opts.name,
		parameters,
		build(params) {
			const size = params[SIZE_PARAM] ?? defaultSize;

			let verts = opts.vertices(params);
			if (opts.chiral && Math.round(params[HANDEDNESS_PARAM] ?? 0) === 1) {
				verts = mirrorVertices(verts);
			}
			const raw = coplanarFaces(verts);
			// inradius = min distance from the origin to any face plane (tangent to
			// the insphere for isohedral solids; the "landing" faces otherwise).
			const inradius = Math.min(...raw.map((f) => Math.abs(f.centroid.dot(f.normal))));
			const scale = size / 2 / inradius;

			// scale every face's geometry uniformly (keeps the solid watertight).
			const scaled: Array<PolyFace> = raw.map((f) => ({
				vertices: f.vertices.map((v) => v.clone().multiplyScalar(scale)),
				centroid: f.centroid.clone().multiplyScalar(scale),
				normal: f.normal
			}));

			scaled.sort((a, b) => compareKeys(faceSortKey(a), faceSortKey(b)));

			// count number faces so the legend picker knows the range.
			const numberCount = scaled.filter((f) => isNumberFace(f.vertices.length)).length;

			let numberIndex = 0;
			const faces: Array<DieFaceModel> = scaled.map((f) => {
				const { shape, transform } = faceFromVertices(f.vertices);
				const numbered = isNumberFace(f.vertices.length);
				const defaultLegend = numbered ? numbering(numberIndex++, numberCount) : Legend.BLANK;
				return { isNumberFace: numbered, shape, defaultLegend, transform };
			});

			// face-to-face distance for sizing: between the two closest opposing
			// faces (the insphere diameter for isohedral solids).
			const faceToFaceDistance = inradius * 2 * scale;

			// explode layout: mixed number/blank solids stack the blanks under the
			// numbers; uniform solids fan out in a simple grid.
			const hasBlanks = faces.some((f) => !f.isNumberFace);
			if (hasBlanks) {
				stackedExplode(faces);
			} else {
				const explodes = gridExplode(faces.map((f) => f.shape));
				faces.forEach((f, i) => (f.explodeTransform = explodes[i]));
			}

			return {
				faceToFaceDistance,
				sizeLegendsIndividually: opts.individualLegendScaling,
				faces
			};
		}
	};
}

// helpers for building vertex sets ------------------------------------------

// all sign combinations of the given magnitudes (2^k points; zeros are not
// duplicated).
export function signs(...coords: Array<number>): Array<Vector3> {
	const out: Array<Vector3> = [];
	const xs = coords[0] === 0 ? [0] : [coords[0], -coords[0]];
	const ys = coords[1] === 0 ? [0] : [coords[1], -coords[1]];
	const zs = coords[2] === 0 ? [0] : [coords[2], -coords[2]];
	for (const x of xs) {
		for (const y of ys) {
			for (const z of zs) {
				out.push(new Vector3(x, y, z));
			}
		}
	}
	return out;
}

// all (3) cyclic permutations of a coordinate triple.
export function cyclic(a: number, b: number, c: number): Array<[number, number, number]> {
	return [
		[a, b, c],
		[c, a, b],
		[b, c, a]
	];
}

// even permutations of a coordinate triple (the 3 cyclic rotations).
export function evenPerms(a: number, b: number, c: number): Array<[number, number, number]> {
	return cyclic(a, b, c);
}

// odd permutations of a coordinate triple (the 3 non-cyclic orderings).
export function oddPerms(a: number, b: number, c: number): Array<[number, number, number]> {
	return [
		[a, c, b],
		[b, a, c],
		[c, b, a]
	];
}

// all (6) permutations of a coordinate triple.
export function allPerms(a: number, b: number, c: number): Array<[number, number, number]> {
	return [
		[a, b, c],
		[a, c, b],
		[b, a, c],
		[b, c, a],
		[c, a, b],
		[c, b, a]
	];
}

// the golden ratio, used for icosahedral-symmetry solids.
export const PHI = (1 + Math.sqrt(5)) / 2;

// the tribonacci constant, used for the (chiral) snub solids.
export const TRIBONACCI =
	(1 + Math.cbrt(19 + 3 * Math.sqrt(33)) + Math.cbrt(19 - 3 * Math.sqrt(33))) / 3;

// generate snub-solid vertices from magnitude triples: even permutations take
// sign patterns with an even number of plus signs, odd permutations take an odd
// number of plus signs. this selects a single chirality.
export function snubVertices(m: [number, number, number]): Array<Vector3> {
	const out: Array<Vector3> = [];
	const add = (perm: [number, number, number], wantEvenPlus: boolean) => {
		for (let s = 0; s < 8; s++) {
			const sx = s & 1 ? -1 : 1;
			const sy = s & 2 ? -1 : 1;
			const sz = s & 4 ? -1 : 1;
			const plusCount = (sx > 0 ? 1 : 0) + (sy > 0 ? 1 : 0) + (sz > 0 ? 1 : 0);
			if ((plusCount % 2 === 0) === wantEvenPlus) {
				out.push(new Vector3(perm[0] * sx, perm[1] * sy, perm[2] * sz));
			}
		}
	};
	evenPerms(m[0], m[1], m[2]).forEach((p) => add(p, true));
	oddPerms(m[0], m[1], m[2]).forEach((p) => add(p, false));
	return out;
}
