// A D8 modelled as a truncated octahedron (the Dice Lab d8 design).
//
// Truncating the 6 vertices of an octahedron turns its 8 triangular faces into
// hexagons and adds a small square where each vertex used to be. We use the 8
// hexagons as the numbered faces (the die reads off a hexagon) and leave the 6
// squares as blank faces. It is more nearly spherical than a regular octahedron
// so it rolls/tumbles better, at the cost of (rarely) landing on a square.
//
// The amount of truncation is a parameter measured in mm from the original
// (sharp) corner: 0 leaves a plain octahedron (8 numbered triangles, no
// squares), larger values grow the square faces. The hexagons live in the same
// planes as the original triangular faces regardless of truncation, so the
// hexagon "face to face" stays equal to the size parameter.

import type { DieModel } from '$lib/interfaces/dice';
import { convexPolyhedronDie } from '$lib/utils/convex_polyhedra';
import { Vector3 } from 'three';

const SIZE_PARAM = 'polyhedron_size';
const TRUNCATION_PARAM = 'trunc_oct_truncation';

const defaultTruncation = 4;
const defaultSize = 18;

// the 6 octahedron corners (unit apexes) and, for each, the 4 neighbours it is
// joined to by an edge.
const APEXES: Array<{ apex: Vector3; neighbours: Array<Vector3> }> = [
	new Vector3(1, 0, 0),
	new Vector3(-1, 0, 0),
	new Vector3(0, 1, 0),
	new Vector3(0, -1, 0),
	new Vector3(0, 0, 1),
	new Vector3(0, 0, -1)
].map((apex) => ({
	apex,
	// neighbours are every other apex that isn't the antipode (those share an edge).
	neighbours: [
		new Vector3(1, 0, 0),
		new Vector3(-1, 0, 0),
		new Vector3(0, 1, 0),
		new Vector3(0, -1, 0),
		new Vector3(0, 0, 1),
		new Vector3(0, 0, -1)
	].filter((p) => Math.abs(p.dot(apex)) < 0.5)
}));

function truncatedOctahedronVertices(params: Record<string, number>): Array<Vector3> {
	const size = params[SIZE_PARAM] ?? defaultSize;
	const truncationMm = params[TRUNCATION_PARAM] ?? defaultTruncation;

	// convexPolyhedronDie scales the unit solid so the hexagon planes (at unit
	// inradius 1/sqrt(3)) sit at size/2. converting the mm truncation into unit
	// space therefore divides by that same scale, so the cut comes out at the
	// requested mm on the finished die.
	const scale = (size / 2) * Math.sqrt(3);
	// an edge runs between two apexes a unit distance apart along each axis, so it
	// has length sqrt(2). cutting past half the edge (t/sqrt(2) >= 0.5) collapses
	// the hexagons, so clamp just short of that to avoid a degenerate solid.
	const tUnit = Math.min(truncationMm / scale, 0.49 * Math.sqrt(2));

	if (tUnit <= 1e-6) {
		// no truncation: plain octahedron (corners are the only vertices).
		return APEXES.map(({ apex }) => apex.clone());
	}

	const out: Array<Vector3> = [];
	for (const { apex, neighbours } of APEXES) {
		for (const n of neighbours) {
			const dir = n.clone().sub(apex).normalize();
			out.push(apex.clone().addScaledVector(dir, tUnit));
		}
	}
	return out;
}

export const TruncatedOctahedronD8: DieModel = convexPolyhedronDie({
	id: 'truncated_octahedron_d8',
	name: 'D8 Truncated',
	vertices: truncatedOctahedronVertices,
	defaultSize: defaultSize,
	minSize: 12,
	extraParameters: [{ id: TRUNCATION_PARAM, defaultValue: defaultTruncation, min: 0, max: 10, step: 0.5 }],
	// squares (4 sides) are the blank faces; the 8 triangles/hexagons are numbered.
	isNumberFace: (sides) => sides !== 4,
	individualLegendScaling: true
});
