// A D4 modelled as a truncated tetrahedron.
//
// Truncating each of the 4 vertices of a regular tetrahedron turns the 4
// original triangular faces into hexagons and adds a small triangle where each
// vertex used to be. We use the 4 small triangles as the numbered faces (so the
// die "reads" off the truncated ends by default) and leave the 4 hexagons as
// blank faces the user can still customise.

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Transform, previewTilt } from '$lib/utils/3d';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices } from '$lib/utils/shapes';
import { Shape, Vector3 } from 'three';

const defaultEdge = 26;
const defaultTruncation = 0.33; // 1/3 is the Archimedean truncated tetrahedron.

const truncatedTetrahedronParameters: Array<DiceParameter> = [
	{
		id: 'trunc_tetra_size',
		// edge length of the underlying tetrahedron (mm).
		defaultValue: defaultEdge,
		min: 10,
		max: 60,
		step: 0.5
	},
	{
		id: 'trunc_tetra_truncation',
		// how far along each edge to cut (0 = no cut, 0.5 = cuts meet). bigger
		// gives larger number triangles and smaller hexagons.
		defaultValue: defaultTruncation,
		min: 0.25,
		max: 0.40,
		step: 0.01
	}
];

// regular tetrahedron vertices for edge length `edge`, centered on the origin.
function tetrahedronVertices(edge: number): Array<Vector3> {
	// these four corners of a cube form a regular tetrahedron with edge 2*sqrt(2).
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

// build a face (shape + placement transform) from its 3D vertices, ensuring the
// shape's engraving front (+z) ends up pointing outward (away from the origin).
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

export const TruncatedTetrahedronD4: DieModel = {
	id: 'truncated_tetrahedron_d4',
	name: 'D4 Truncated',
	parameters: truncatedTetrahedronParameters,
	build(params) {
		const edge = params.trunc_tetra_size ?? defaultEdge;
		const f = params.trunc_tetra_truncation ?? defaultTruncation;
		const v = tetrahedronVertices(edge);

		// the 4 numbered triangles, one at each truncated vertex. its corners are
		// the cut points a fraction f along the three edges leaving the vertex.
		const triangles: Array<DieFaceModel> = v.map((vertex, i) => {
			const neighbours = v.filter((_, j) => j !== i);
			const corners = neighbours.map((n) => lerp(vertex, n, f));
			const { shape, transform } = faceFromVertices(corners);
			return {
				isNumberFace: true,
				shape,
				defaultLegend: pickForNumber(i, 4),
				transform
			};
		});

		// the 4 hexagonal faces: each original tetra face (the three vertices that
		// are NOT one of the four) with every corner cut back along its two edges.
		const hexagons: Array<DieFaceModel> = v.map((_, k) => {
			const [a, b, c] = v.filter((_, j) => j !== k);
			const corners = [
				lerp(a, b, f),
				lerp(b, a, f),
				lerp(b, c, f),
				lerp(c, b, f),
				lerp(c, a, f),
				lerp(a, c, f)
			];
			const { shape, transform } = faceFromVertices(corners);
			return {
				isNumberFace: false,
				shape,
				defaultLegend: Legend.BLANK,
				transform
			};
		});

		const faces = [...triangles, ...hexagons];

		// face-to-face: a numbered triangle and the hexagon opposite it are
		// parallel; the distance between those planes is the natural "size".
		const triCentroid = triangles[0].transform.translation;
		const hexCentroid = hexagons[0].transform.translation;
		const axis = v[0].clone().normalize();
		const faceToFaceDistance = Math.abs(triCentroid.dot(axis)) + Math.abs(hexCentroid.dot(axis));

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
