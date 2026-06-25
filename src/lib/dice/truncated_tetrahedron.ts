// A D4 modelled as a truncated tetrahedron.
//
// Truncating each of the 4 vertices of a regular tetrahedron turns the 4
// original triangular faces into hexagons and adds a small triangle where each
// vertex used to be. We use the 4 small triangles as the numbered faces (so the
// die "reads" off the truncated ends by default) and leave the 4 hexagons as
// blank faces the user can still customise.
//
// This solid is NOT isohedral (two face shapes), so it does not use the generic
// isohedral builder. Instead it builds one triangle shape and one hexagon shape
// and places copies of each via the (chiral) tetrahedral rotation group - so all
// four triangles (and all four hexagons) share one `Shape`, keeping the exploded
// view and engraved legends consistently oriented.

import type { DieFaceModel, DieModel } from '$lib/interfaces/dice';
import {
	compareKeys,
	orbitFace,
	orderCoplanar,
	rotationGroupOf,
	type PlacedFaces
} from '$lib/utils/convex_polyhedra';
import { previewTilt } from '$lib/utils/3d';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { Vector3 } from 'three';

const defaultEdge = 26;
const defaultTruncation = 0.33; // 1/3 is the Archimedean truncated tetrahedron.

// round to 3 dp so near-equal face centroids sort deterministically.
const r3 = (x: number) => Math.round(x * 1e3) / 1e3;

// regular tetrahedron vertices for edge length `edge`, centered on the origin.
// these four corners of a cube (with an even number of minus signs) form a
// regular tetrahedron whose rotation symmetry is exactly `tetrahedralRotations`.
function tetrahedronVertices(edge: number): Array<Vector3> {
	const base = [
		new Vector3(1, 1, 1),
		new Vector3(1, -1, -1),
		new Vector3(-1, 1, -1),
		new Vector3(-1, -1, 1)
	];
	const s = edge / (2 * Math.SQRT2);
	return base.map((v) => v.clone().multiplyScalar(s));
}

// point a fraction `f` of the way from `a` toward `b`.
function lerp(a: Vector3, b: Vector3, f: number): Vector3 {
	return a.clone().lerp(b, f);
}

// turn a group orbit of one face into DieFaceModels (one shared shape).
function placedToFaces(placed: PlacedFaces, isNumberFace: boolean): Array<DieFaceModel> {
	return placed.transforms.map((transform) => ({
		isNumberFace,
		shape: placed.shape,
		defaultLegend: Legend.BLANK,
		transform
	}));
}

export const TruncatedTetrahedronD4: DieModel = {
	id: 'd4_truncated_tetrahedron',
	name: 'D4 Truncated',
	parameters: [
		{ id: 'trunc_tetra_size', defaultValue: defaultEdge, min: 10, max: 60, step: 0.5 },
		{
			id: 'trunc_tetra_truncation',
			defaultValue: defaultTruncation,
			min: 0.25,
			max: 0.4,
			step: 0.01
		}
	],
	build(params) {
		const edge = params.trunc_tetra_size ?? defaultEdge;
		const f = params.trunc_tetra_truncation ?? defaultTruncation;
		const v = tetrahedronVertices(edge);

		const v0 = v[0];
		const [a, b, c] = v.slice(1);

		// the numbered triangle at the truncated v0 vertex: cut points a fraction f
		// along the three edges leaving v0.
		const triSeed = orderCoplanar([lerp(v0, a, f), lerp(v0, b, f), lerp(v0, c, f)]);
		// the blank hexagon opposite v0: the original face (a, b, c) with every
		// corner cut back along its two edges.
		const hexSeed = orderCoplanar([
			lerp(a, b, f),
			lerp(b, a, f),
			lerp(b, c, f),
			lerp(c, b, f),
			lerp(c, a, f),
			lerp(a, c, f)
		]);

		// the truncated tetrahedron shares the tetrahedron's rotational symmetry (T).
		const rotations = rotationGroupOf(v);
		const triangles = placedToFaces(orbitFace(triSeed, rotations), true);
		const hexagons = placedToFaces(orbitFace(hexSeed, rotations), false);

		const key = (face: DieFaceModel) => {
			const p = face.transform.translation;
			return [-r3(p.y), -r3(p.x), -r3(p.z)];
		};
		triangles.sort((x, y) => compareKeys(key(x), key(y)));
		triangles.forEach((face, i) => (face.defaultLegend = pickForNumber(i, triangles.length)));

		const faces = [...triangles, ...hexagons];

		// face-to-face: a numbered triangle and the hexagon opposite it are
		// parallel; sum their plane distances along the v0 axis.
		const axis = v0.clone().normalize();
		const avg = (pts: Array<Vector3>) =>
			pts.reduce((acc, p) => acc.add(p.clone()), new Vector3()).multiplyScalar(1 / pts.length);
		const faceToFaceDistance = Math.abs(avg(triSeed).dot(axis)) + Math.abs(avg(hexSeed).dot(axis));

		stackedExplode(faces, { numberColumns: 4 });

		return {
			faces,
			faceToFaceDistance,
			// the numbered triangles are flat; tilt the preview to reveal the
			// hexagonal sides and the truncated 3D shape.
			previewTransform: previewTilt()
		};
	}
};
