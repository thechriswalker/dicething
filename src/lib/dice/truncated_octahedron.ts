// A D8 modelled as a truncated octahedron (the Dice Lab d8 design).
//
// Truncating the 6 vertices of an octahedron turns its 8 triangular faces into
// hexagons and adds a small square where each vertex used to be. We use the 8
// hexagons as the numbered faces (the die reads off a hexagon) and leave the 6
// squares as blank faces. It is more nearly spherical than a regular octahedron
// so it rolls/tumbles better, at the cost of (rarely) landing on a square.
//
// This solid is NOT isohedral (two face shapes), so it does not use the generic
// isohedral builder. Instead it builds one hexagon shape and one square shape
// and places copies of each via the octahedral rotation group - so every
// hexagon (and every square) shares one `Shape`, keeping the exploded view and
// engraved legends consistently oriented.
//
// The amount of truncation is a parameter measured in mm from the original
// (sharp) corner: 0 leaves a plain octahedron (8 numbered triangles, no
// squares), larger values grow the square faces. The hexagons live in the same
// planes as the original triangular faces regardless of truncation, so the
// hexagon "face to face" stays equal to the size parameter.

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import {
	compareKeys,
	orbitFace,
	orderCoplanar,
	rotationGroupOf,
	type PlacedFaces
} from '$lib/utils/convex_polyhedra';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { Vector3 } from 'three';

// round to 3 dp so near-equal face centroids sort deterministically.
const r3 = (x: number) => Math.round(x * 1e3) / 1e3;

const SIZE_PARAM = 'polyhedron_size';
const TRUNCATION_PARAM = 'trunc_oct_truncation';

const defaultTruncation = 4;
const defaultSize = 18;

// the 6 octahedron apex directions (unit).
const AXES: Array<Vector3> = [
	new Vector3(1, 0, 0),
	new Vector3(-1, 0, 0),
	new Vector3(0, 1, 0),
	new Vector3(0, -1, 0),
	new Vector3(0, 0, 1),
	new Vector3(0, 0, -1)
];

// the four apexes joined to `apex` by an edge (every apex except its antipode).
function neighbours(apex: Vector3): Array<Vector3> {
	return AXES.filter((p) => Math.abs(p.dot(apex)) < 0.5);
}

// point `t` mm along the edge from `a` toward `b`.
function cut(a: Vector3, b: Vector3, t: number): Vector3 {
	return a.clone().addScaledVector(b.clone().sub(a).normalize(), t);
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


const defaultParameters: Array<DiceParameter> = [
	{ id: SIZE_PARAM, defaultValue: defaultSize, min: 12, max: 60, step: 0.1 },
	{ id: TRUNCATION_PARAM, defaultValue: defaultTruncation, min: 0, max: 10, step: 0.05 }
];

export const TruncatedOctahedronD8: DieModel = {
	id: 'd8_truncated_octahedron',
	name: 'D8 Truncated',
	parameters: defaultParameters,
	blankParameters: truncatedOctahedronBlankParams(Object.fromEntries(defaultParameters.map(p => [p.id, p.defaultValue]))),
	build(params) {
		const size = params[SIZE_PARAM] ?? defaultSize;
		const truncationMm = params[TRUNCATION_PARAM] ?? defaultTruncation;

		// scale the unit octahedron so the original triangle planes (the hexagon
		// planes) sit at size/2 from the centre - i.e. hexagon face-to-face = size.
		const scale = (size / 2) * Math.sqrt(3);
		const apexes = AXES.map((a) => a.clone().multiplyScalar(scale));
		// an edge runs sqrt(2)*scale between two apexes; clamp the cut just short of
		// the midpoint so the hexagons never collapse.
		const t = Math.min(truncationMm, 0.49 * Math.SQRT2 * scale);

		// the truncated octahedron shares the octahedron's rotational symmetry (O).
		const rotations = rotationGroupOf(AXES);

		// the +++ octant triangle (one apex from each positive axis).
		const apexX = apexes[0];
		const apexY = apexes[2];
		const apexZ = apexes[4];

		let faces: Array<DieFaceModel>;

		if (t <= 1e-6) {
			// no truncation: a plain octahedron, all 8 triangles numbered.
			const triSeed = orderCoplanar([apexX.clone(), apexY.clone(), apexZ.clone()]);
			faces = placedToFaces(orbitFace(triSeed, rotations), true);
		} else {
			// hexagon: the +++ triangle with each corner cut back along its two edges.
			const hexSeed = orderCoplanar([
				cut(apexX, apexY, t),
				cut(apexY, apexX, t),
				cut(apexY, apexZ, t),
				cut(apexZ, apexY, t),
				cut(apexZ, apexX, t),
				cut(apexX, apexZ, t)
			]);
			// square: the cut points around the +x apex.
			const squareSeed = orderCoplanar(
				neighbours(AXES[0]).map((n) => cut(apexX, n.clone().multiplyScalar(scale), t))
			);

			const hexagons = placedToFaces(orbitFace(hexSeed, rotations), true);
			const squares = placedToFaces(orbitFace(squareSeed, rotations), false);
			// resting on a blank square reads no number; the truncated d8 can settle
			// on one (rarely, growing with truncation) - the trade-off for rolling
			// better - so flag the squares for the (reassuring) land-warning. A plain
			// octahedron (no truncation) has no squares, so it never warns.
			squares.forEach((f) => (f.noRest = true));
			faces = [...hexagons, ...squares];
		}

		// number the (hexagon/triangle) faces in a stable top-to-bottom order.
		const numbered = faces.filter((f) => f.isNumberFace);
		const key = (f: DieFaceModel) => {
			const c = f.transform.translation;
			return [-r3(c.y), -r3(c.x), -r3(c.z)];
		};
		numbered.sort((a, b) => compareKeys(key(a), key(b)));
		numbered.forEach((f, i) => (f.defaultLegend = pickForNumber(i, numbered.length)));

		stackedExplode(faces);

		return {
			faces,
			faceToFaceDistance: size
		};
	}
};

function truncatedOctahedronBlankParams(defaultParameters: Record<string, number>): (params: Record<string, number>, offset: number) => Record<string, number> {
	return (params, offset) => {
		const size = params[SIZE_PARAM] ?? defaultParameters[SIZE_PARAM] ?? defaultSize;
		const truncationMm = params[TRUNCATION_PARAM] ?? defaultParameters[TRUNCATION_PARAM] ?? defaultTruncation;
		return {
			...params,
			[SIZE_PARAM]: size - offset,
			[TRUNCATION_PARAM]: truncationMm - offset
		};
	};
}