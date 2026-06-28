// Build the printable base + lid geometry for an EDDC-style clamshell box from a
// dice set and a BoxConfig. All geometry is produced in a Z-up frame (the
// printed piece rests on z = 0), using manifold-3d for the CSG so the result is
// guaranteed watertight + manifold.
//
// Design:
//   - The base and lid are *equal height* solid octagonal slabs. The footprint
//     is a rectangle big enough for the dice; its four corners are truncated by
//     `chamfer` so the slab reads as an 8-sided shape from above.
//   - Every die straddles the seam: its mid-point sits on the top face of the
//     base (= the seam where the halves meet). So the base holds the lower half
//     of each die and the lid holds the (z-mirrored) upper half. Each cavity is
//     milled into the solid slab from the seam face.
//   - Magnets sit in the truncated corners (solid material), bored from the seam
//     so a magnet in the base meets its partner in the lid. Unhinged boxes get
//     four (one per corner); hinged boxes get two (the opening side only).

import type { DiceSet } from '$lib/interfaces/storage.svelte';
import type { DieModel } from '$lib/interfaces/dice';
import dice from '$lib/dice';
import { Box3, BufferGeometry, Vector2, Vector3 } from 'three';
import type { CrossSection, Manifold } from 'manifold-3d';
import {
	getManifold,
	manifold,
	geometryToManifold,
	manifoldToGeometry,
	deleteAll
} from '$lib/utils/manifold';
import { repairDegenerateTriangles } from '$lib/utils/bad_edges';
import { orientDieSolid } from './orient';
import { layoutDice, type LayoutItem } from './layout';
import type { BoxConfig, BoxHalf, BoxParams } from './types';

export type PlacedDie = {
	dieId: string;
	half: BoxHalf;
	// the true die solid, already positioned (straddling the seam) for preview.
	// Not exported as part of the box.
	geometry: BufferGeometry;
};

// Closed 2D outlines (box xy frame, centred) for the developer boundary overlay.
export type BoxBoundaries = {
	// each placed die's maximal 2D footprint (projected convex hull).
	dice: Array<Array<Vector2>>;
	// the convex hull around every die's footprint combined.
	combined: Array<Vector2>;
	// the box interior outline (the recess octagon the dice must fit within).
	inner: Array<Vector2>;
};

export type BuiltBox = {
	base: BufferGeometry;
	lid: BufferGeometry;
	placedDice: Array<PlacedDie>;
	// outer footprint (x,y) and per-piece heights, for camera framing / info.
	outer: Vector2;
	baseHeight: number;
	lidHeight: number;
	boundaries: BoxBoundaries;
};

// A die prepared for the box: its cavity (oversized) and true solids laid flat,
// plus the layout footprint/height and the cavity's projected 2D outline.
type PreparedDie = {
	dieId: string;
	cavity: BufferGeometry; // oversized solid, centred xy, bottom at z=0
	solid: BufferGeometry; // true die solid, centred xy, bottom at z=0
	size: Vector3; // cavity size (x,y footprint, z height)
	// convex hull of the cavity projected onto the xy plane, centred on the die.
	// This is the die's true maximal footprint shape (not just its bounding box),
	// used to fit the interior octagon tightly around the dice.
	hull: Array<Vector2>;
};

// Convex hull (CCW) of 2D points via Andrew's monotone chain. Returns the input
// (deduped) when there are fewer than 3 points.
function convexHull2D(points: Array<[number, number]>): Array<[number, number]> {
	const pts = points
		.slice()
		.sort((a, b) => a[0] - b[0] || a[1] - b[1])
		.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
	if (pts.length < 3) {
		return pts;
	}
	const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const lower: Array<[number, number]> = [];
	for (const p of pts) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
			lower.pop();
		}
		lower.push(p);
	}
	const upper: Array<[number, number]> = [];
	for (let i = pts.length - 1; i >= 0; i--) {
		const p = pts[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
			upper.pop();
		}
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

// The convex hull of a geometry's vertices projected onto the xy plane.
function projectedHull(geo: BufferGeometry): Array<Vector2> {
	const pos = geo.getAttribute('position');
	const pts: Array<[number, number]> = [];
	for (let i = 0; i < pos.count; i++) {
		pts.push([pos.getX(i), pos.getY(i)]);
	}
	return convexHull2D(pts).map(([x, y]) => new Vector2(x, y));
}

// Build the cavity ("bigger") and true faces for a die, then lay both flat.
function prepareDie(
	model: DieModel,
	params: Record<string, number>,
	stringParams: Record<string, string>,
	dieId: string,
	cavityTolerance: number,
	extraRotation: number
): PreparedDie {
	const trueFaces = model.build(params, stringParams).faces;
	const trueOriented = orientDieSolid(model, trueFaces, extraRotation);

	// the cavity is the die grown by the clearance so the real die drops in. A
	// model that knows how to resize itself does so exactly (negative offset =
	// bigger, per blanks.ts); otherwise we uniformly scale the true solid.
	let cavity: BufferGeometry;
	let cavitySize: Vector3;
	if (model.blankParameters && cavityTolerance > 0) {
		const biggerParams = model.blankParameters(params, -cavityTolerance);
		const cavityFaces = model.build(biggerParams, stringParams).faces;
		const oriented = orientDieSolid(model, cavityFaces, extraRotation);
		cavity = oriented.geometry;
		cavitySize = oriented.size;
	} else if (cavityTolerance > 0) {
		cavity = trueOriented.geometry.clone();
		const s = trueOriented.size;
		// grow so the footprint gains 2 x tolerance on its largest dimension.
		const maxDim = Math.max(s.x, s.y, s.z) || 1;
		const scale = (maxDim + 2 * cavityTolerance) / maxDim;
		cavity.scale(scale, scale, scale);
		cavity.computeBoundingBox();
		const bb = cavity.boundingBox!;
		const size = new Vector3();
		bb.getSize(size);
		cavity.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
		cavitySize = size;
	} else {
		cavity = trueOriented.geometry.clone();
		cavitySize = trueOriented.size.clone();
	}

	return {
		dieId,
		cavity,
		solid: trueOriented.geometry,
		size: cavitySize,
		hull: projectedHull(cavity)
	};
}

// A CCW octagon: the rectangle of half-extents (hx, hy) with its four corners
// cut back by `c` (a 45-degree truncation). The chamfer is clamped so it can't
// exceed half the smaller side.
function octagonCS(hx: number, hy: number, c: number): CrossSection {
	return octagonCSPerCorner(hx, hy, c, c, c, c);
}

// As octagonCS, but each corner can be truncated by a different amount: cpp is
// the (+,+) corner, then (-,+), (-,-), (+,-) going CCW. Clamping every corner to
// the shorter half-extent keeps adjacent truncations on one edge from
// overlapping (their sum stays within the edge length).
function octagonPointsPerCorner(
	hx: number,
	hy: number,
	cpp: number,
	cmp: number,
	cmm: number,
	cpm: number
): Array<[number, number]> {
	const lim = Math.min(hx, hy) - 0.01;
	const clamp = (c: number) => Math.max(0, Math.min(c, lim));
	const app = clamp(cpp);
	const amp = clamp(cmp);
	const amm = clamp(cmm);
	const apm = clamp(cpm);
	return [
		[hx, -hy + apm],
		[hx, hy - app],
		[hx - app, hy],
		[-hx + amp, hy],
		[-hx, hy - amp],
		[-hx, -hy + amm],
		[-hx + amm, -hy],
		[hx - apm, -hy]
	];
}

function octagonCSPerCorner(
	hx: number,
	hy: number,
	cpp: number,
	cmp: number,
	cmm: number,
	cpm: number
): CrossSection {
	const wasm = manifold();
	return new wasm.CrossSection(octagonPointsPerCorner(hx, hy, cpp, cmp, cmm, cpm), 'Positive');
}

// Uniform scale relating the body octagon to one shrunk in by ~`bevel` on its
// perimeter. Used to size the truncated bottom face of the bevelled slab.
function bevelScale(outerHalf: Vector2, bevel: number): number {
	return Math.max((outerHalf.x + bevel) / outerHalf.x, (outerHalf.y + bevel) / outerHalf.y);
}

// The solid octagonal slab for one half (rests on z = 0, extends to +height).
// `outerHalf` is the body / seam footprint. `bevel` truncates the exterior
// bottom edge (the z = 0 face, which prints on the bed): the slab is narrowest
// there and grows outward over `bevel` up to the body octagon, then runs
// straight to the seam. This is the EDDC case's chamfered outer profile - a
// 45-degree corner truncation of the bottom edge (a printable overhang). The
// seam face stays the body octagon so the two halves mate flat.
function octagonSlab(outerHalf: Vector2, chamfer: number, height: number, bevel = 0): Manifold {
	const wasm = manifold();
	const full = octagonCS(outerHalf.x, outerHalf.y, chamfer);
	const b = Math.max(0, Math.min(bevel, height - 0.5));
	if (b <= 0) {
		const slab = full.extrude(height);
		full.delete();
		return slab;
	}
	// exterior octagon (z = 0) = body shrunk in by the bevel, growing back out to
	// the body octagon at z = b (kept self-similar so the chamfer reads cleanly).
	const s = bevelScale(outerHalf, b);
	const exteriorCS = octagonCS(outerHalf.x / s, outerHalf.y / s, chamfer / s);
	// extrude(height, nDivisions, twistDegrees, scaleTop): exterior -> body.
	const frustum = exteriorCS.extrude(b, 0, 0, [s, s]);
	const prism = full.extrude(height - b).translate([0, 0, b]);
	const slab = wasm.Manifold.union(frustum, prism);
	full.delete();
	exteriorCS.delete();
	deleteAll(frustum, prism);
	return slab;
}

// Translate a die geometry (already centred in x/y on the origin) so its centre
// in Z sits at `z`, and its x/y centre sits at (x, y).
function placeCentredAtZ(geo: BufferGeometry, x: number, y: number, z: number): void {
	geo.computeBoundingBox();
	const bb = geo.boundingBox ?? new Box3();
	const cz = (bb.min.z + bb.max.z) / 2;
	geo.translate(x, y, z - cz);
}

// Lateral footprint of the vertical sweep tool (a hair of extra clearance).
const DRAFT_SWEEP_FOOTPRINT = 0.02;

// Sweep a die solid straight UP (the removal direction) so the cavity it cuts
// has no inward-leaning walls - the imprint you'd get by pressing the die into a
// surface. Implemented as a Minkowski sum with a thin, tall box: the box's +z
// extent smears every cross-section upward, so within the slab (below the seam)
// each horizontal slice contains those beneath it (draft-free for upward
// removal). The smeared cone above the seam is trimmed when the cavity is cut
// from the slab. Caller owns the result; the passed-in `die` is not deleted.
function sweepUp(die: Manifold): Manifold {
	const wasm = manifold();
	const bb = die.boundingBox();
	const height = bb.max[2] - bb.min[2];
	const e = DRAFT_SWEEP_FOOTPRINT;
	const seg = wasm.Manifold.cube([e, e, height + 1], false).translate([-e / 2, -e / 2, 0]);
	const swept = die.minkowskiSum(seg);
	seg.delete();
	return swept;
}

// Build the up-swept (draft-free) cavity manifold for one die, placed with its
// mid-point on the seam. `mirror` flips the die about X for the lid so the half
// that lands in the lid is its top, mating with the base when the lid is closed.
function sweptCavity(
	cavityGeo: BufferGeometry,
	mirror: boolean,
	x: number,
	y: number,
	seam: number
): Manifold {
	const geo = cavityGeo.clone();
	if (mirror) {
		geo.rotateX(Math.PI);
	}
	placeCentredAtZ(geo, x, y, seam);
	const die = geometryToManifold(geo);
	geo.dispose();
	const swept = sweepUp(die);
	die.delete();
	return swept;
}

// Magnet centres (x,y): just inside each truncated corner, in the solid corner
// material. The hinge runs along the +y edge, so `count` (0/2/4) takes the
// opening (-y) side corners first - those are furthest from the hinge, where the
// clasp force is needed. 4 = one per corner.
export function magnetCorners(
	outerHalf: Vector2,
	chamfer: number,
	radius: number,
	wall: number,
	count: number
): Array<Vector2> {
	// chamfer-face midpoint for the ++ corner, then inset inward along the
	// diagonal so the bore keeps a full `wall` of material to the chamfer face
	// (the closest exterior edge). The inset is measured along the diagonal, so
	// the perpendicular gap to the chamfer face is inset * SQRT2 = radius + wall.
	const mx = outerHalf.x - chamfer / 2;
	const my = outerHalf.y - chamfer / 2;
	const inset = (radius + wall) / Math.SQRT2;
	const cx = mx - inset;
	const cy = my - inset;
	const all = [
		new Vector2(cx, -cy), // opening-right (+,-)
		new Vector2(-cx, -cy), // opening-left (-,-)
		new Vector2(cx, cy), // hinge-right (+,+)
		new Vector2(-cx, cy) // hinge-left (-,+)
	];
	return all.slice(0, Math.max(0, Math.min(4, Math.round(count))));
}

// The chamfer of the interior recess octagon (the body octagon inset by `wall`).
// The magnet corners must stay full height (the magnets mate at the seam, not in
// the recess), so each diagonal edge is pulled in until it is a straight line
// tangent to the magnet boss circle (distance `bossRadius` from the magnet
// centre on its inner side) - leaving a solid triangular corner rather than a
// recess that hugs round each housing. For octagon(innerX, innerY, c) the ++
// diagonal edge is the line x + y = innerX + innerY - c; tangency to the boss at
// (|cx|,|cy|) gives c = innerX + innerY - (|cx| + |cy|) + bossRadius * SQRT2.
// This value is invariant under growing outerHalf (both terms grow together), so
// the footprint sizing can rely on it. `base` is the recess chamfer floor before
// any magnet widening (the dice-derived truncation, see buildBox).
export function recessChamfer(
	outerHalf: Vector2,
	wall: number,
	base: number,
	corners: Array<Vector2>,
	bossRadius: number
): number {
	const innerX = Math.max(1, outerHalf.x - wall);
	const innerY = Math.max(1, outerHalf.y - wall);
	let c = Math.max(0, base);
	if (corners.length > 0) {
		const c0 = corners[0];
		c = Math.max(c, innerX + innerY - (Math.abs(c0.x) + Math.abs(c0.y)) + bossRadius * Math.SQRT2);
	}
	return c;
}

// A shallow recess cut into the interior of the seam face: the recess octagon
// (see recessChamfer), sunk `depth` below the seam, leaving a flat perimeter rim
// and solid magnet corners. Only corners that actually hold a magnet are pulled
// in to clear its boss; the rest keep the tight (wall-thick) chamfer, so a
// 2-magnet box doesn't leave needlessly thick walls on its magnet-free corners.
// Per-corner chamfers for the recess octagon: the tight (dice/user) floor on
// every corner, widened to the magnet-tangent value on the corners that hold a
// magnet. Order is (+,+), (-,+), (-,-), (+,-) - matching octagon*PerCorner.
function recessCornerChamfers(
	outerHalf: Vector2,
	wall: number,
	base: number,
	corners: Array<Vector2>,
	bossRadius: number
): [number, number, number, number] {
	const cTight = Math.max(0, base);
	const cMag = recessChamfer(outerHalf, wall, base, corners, bossRadius);
	const corner = (sx: number, sy: number) =>
		corners.some((c) => Math.sign(c.x) === sx && Math.sign(c.y) === sy) ? cMag : cTight;
	return [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
}

// The recess octagon outline (the interior boundary the dice must fit within),
// as a closed polygon in the box xy frame.
function recessOctagonPoints(
	outerHalf: Vector2,
	wall: number,
	base: number,
	corners: Array<Vector2>,
	bossRadius: number
): Array<Vector2> {
	const innerX = Math.max(1, outerHalf.x - wall);
	const innerY = Math.max(1, outerHalf.y - wall);
	const c = recessCornerChamfers(outerHalf, wall, base, corners, bossRadius);
	return octagonPointsPerCorner(innerX, innerY, ...c).map(([x, y]) => new Vector2(x, y));
}

function trayCutter(
	outerHalf: Vector2,
	wall: number,
	base: number,
	depth: number,
	seam: number,
	corners: Array<Vector2>,
	bossRadius: number
): Manifold {
	const innerX = Math.max(1, outerHalf.x - wall);
	const innerY = Math.max(1, outerHalf.y - wall);
	const c = recessCornerChamfers(outerHalf, wall, base, corners, bossRadius);
	const cs = octagonCSPerCorner(innerX, innerY, ...c);
	const tray = cs.extrude(depth).translate([0, 0, seam - depth]);
	cs.delete();
	return tray;
}

// Magnet bore manifolds, sunk DOWN from the seam surface `topZ`. push-in bores
// are open at the seam; print-in bores are blind (a thin bridge prints over the
// magnet to capture it mid-print).
function magnetBores(params: BoxParams, corners: Array<Vector2>, topZ: number): Array<Manifold> {
	const wasm = manifold();
	const mag = params.magnets;
	if (!mag.enabled) {
		return [];
	}
	const radius = mag.diameter / 2 + mag.tolerance;
	const depth = mag.thickness + mag.tolerance;
	const bridge = mag.mode === 'printin' ? 0.4 : 0;
	const bores: Array<Manifold> = [];
	for (const c of corners) {
		const top = topZ - bridge;
		const cyl = wasm.Manifold.cylinder(depth, radius, radius, 48, false).translate([
			c.x,
			c.y,
			top - depth
		]);
		bores.push(cyl);
	}
	return bores;
}

// mesh_check welds coincident corners on a 1e-4 mm grid; Manifold's working
// tolerance can be finer, so it leaves slivers that read as degenerate after
// that weld. Simplifying just above the weld grid collapses those short edges
// (surfaces move < tolerance) without touching real features.
const CLEAN_TOLERANCE = 3e-4;

// Subtract a list of cutters from a base manifold, returning the result
// geometry. Deletes base + all cutters.
//
// A symmetric die cavity whose silhouette touches the seam-cut plane on a
// symmetry axis can make Manifold emit a pair of coincident vertices there (a
// +0 / -0 split), leaving zero-area sliver triangles on the seam face. They
// contribute no surface (their two real edges cancel), so the standard
// repairDegenerateTriangles pass drops them while keeping the mesh closed -
// exactly what the engraving export pipeline does for the same class of sliver.
function cutToGeometry(base: Manifold, cutters: Array<Manifold>): BufferGeometry {
	const wasm = manifold();
	if (cutters.length === 0) {
		const cleaned = base.simplify(CLEAN_TOLERANCE);
		const geo = manifoldToGeometry(cleaned);
		deleteAll(base, cleaned);
		return repairDegenerateTriangles(geo);
	}
	const union = wasm.Manifold.union(cutters);
	const result = wasm.Manifold.difference(base, union);
	const cleaned = result.simplify(CLEAN_TOLERANCE);
	const geo = manifoldToGeometry(cleaned);
	deleteAll(base, union, result, cleaned, ...cutters);
	return repairDegenerateTriangles(geo);
}

// Rotate a 2D hull (about the origin) by `angle` radians. The die's in-plane
// rotation is a spin about the vertical axis (see orientDieSolid), so rotating
// its projected hull in 2D matches re-preparing the die at that rotation.
export function rotateHull(hull: Array<Vector2>, angle: number): Array<Vector2> {
	if (!angle) {
		return hull.map((h) => h.clone());
	}
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return hull.map((h) => new Vector2(h.x * c - h.y * s, h.x * s + h.y * c));
}

function hullExtent(hull: Array<Vector2>): Vector2 {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const h of hull) {
		minX = Math.min(minX, h.x);
		minY = Math.min(minY, h.y);
		maxX = Math.max(maxX, h.x);
		maxY = Math.max(maxY, h.y);
	}
	if (!isFinite(minX)) {
		return new Vector2(0, 0);
	}
	return new Vector2(maxX - minX, maxY - minY);
}

// The parametric auto-layout: arrange the dice in rows, centre the field, and fit
// the box (outerHalf) tightly around the combined hull with the user margins,
// growing it only as much as the chamfer/magnet corners require. `items` carry
// each die's hull already in its chosen rotation. This is the sizing the box used
// before the manual editor existed; it now also seeds the editor.
export function deriveAutoLayout(
	items: Array<{ dieId: string; hull: Array<Vector2> }>,
	p: BoxParams
): { positions: Map<string, Vector2>; outerHalf: Vector2 } {
	const layoutItems: Array<LayoutItem> = items.map((it) => ({
		dieId: it.dieId,
		footprint: hullExtent(it.hull)
	}));
	const layout = layoutDice(layoutItems, p.gap, p.rows);

	const placedHull: Array<Vector2> = [];
	for (const it of items) {
		const pos = layout.positions.get(it.dieId) ?? new Vector2(0, 0);
		for (const h of it.hull) {
			placedHull.push(new Vector2(h.x + pos.x, h.y + pos.y));
		}
	}
	// centre the field on the origin so the box stays symmetric (lid mirroring,
	// magnet corners). Shift every die position by the same offset.
	let cxField = 0;
	let cyField = 0;
	if (placedHull.length > 0) {
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const pt of placedHull) {
			minX = Math.min(minX, pt.x);
			maxX = Math.max(maxX, pt.x);
			minY = Math.min(minY, pt.y);
			maxY = Math.max(maxY, pt.y);
		}
		cxField = (minX + maxX) / 2;
		cyField = (minY + maxY) / 2;
	}
	const positions = new Map<string, Vector2>();
	for (const it of items) {
		const pos = layout.positions.get(it.dieId) ?? new Vector2(0, 0);
		positions.set(it.dieId, new Vector2(pos.x - cxField, pos.y - cyField));
	}

	// octagon support of the centred hull: half-extents and the diagonal reach.
	let sx = 0;
	let sy = 0;
	let sd = 0;
	for (const pt of placedHull) {
		const x = pt.x - cxField;
		const y = pt.y - cyField;
		sx = Math.max(sx, Math.abs(x));
		sy = Math.max(sy, Math.abs(y));
		sd = Math.max(sd, Math.abs(x + y), Math.abs(x - y));
	}
	const cDice = Math.max(0, sx + sy - sd);

	const magRadius = p.magnets.diameter / 2 + p.magnets.tolerance;
	const trayBossR = magRadius + 1.0;
	const bodyChamfer = Math.max(p.chamfer, cDice + p.wall * (2 - Math.SQRT2));
	const recessBase = Math.max(cDice, bodyChamfer - p.wall);
	const cornersFor = (oh: Vector2): Array<Vector2> =>
		p.magnets.enabled ? magnetCorners(oh, bodyChamfer, magRadius, p.wall, p.magnets.count) : [];

	const rx = Math.max(sx + p.marginX, 8);
	const ry = Math.max(sy + p.marginY, 8);
	const outerHalf = new Vector2(rx + p.wall, ry + p.wall);

	// grow the footprint if the effective truncation cuts in past where the dice
	// reach (see the long-form note this was extracted from).
	if (p.trayDepth > 0) {
		const cEff = recessChamfer(outerHalf, p.wall, recessBase, cornersFor(outerHalf), trayBossR);
		const g = Math.max(0, (cEff - cDice) / 2);
		outerHalf.x += g;
		outerHalf.y += g;
	} else {
		const g = Math.max(0, (bodyChamfer - cDice - 2 * p.wall) / 2);
		outerHalf.x += g;
		outerHalf.y += g;
	}
	return { positions, outerHalf };
}

// Everything needed to draw / cut the box shell for a given footprint and dice
// field: the body + interior (recess) octagon outlines, the magnet corners, and
// the derived chamfers. Both buildBox and the 2D editor use this so what the
// editor shows exactly matches what gets built. `placedHull` is every die's hull
// in the centred box frame.
export type BoxOutline = {
	bodyChamfer: number;
	recessBase: number;
	magRadius: number;
	trayBossR: number;
	corners: Array<Vector2>; // base-side magnet corners (opening side first)
	body: Array<Vector2>; // body octagon outline
	inner: Array<Vector2>; // interior recess octagon outline
};

export function boxOutline(
	p: BoxParams,
	outerHalf: Vector2,
	placedHull: Array<Vector2>
): BoxOutline {
	let sx = 0;
	let sy = 0;
	let sd = 0;
	for (const pt of placedHull) {
		sx = Math.max(sx, Math.abs(pt.x));
		sy = Math.max(sy, Math.abs(pt.y));
		sd = Math.max(sd, Math.abs(pt.x + pt.y), Math.abs(pt.x - pt.y));
	}
	const cDice = Math.max(0, sx + sy - sd);
	const magRadius = p.magnets.diameter / 2 + p.magnets.tolerance;
	const trayBossR = magRadius + 1.0;
	const bodyChamfer = Math.max(p.chamfer, cDice + p.wall * (2 - Math.SQRT2));
	const recessBase = Math.max(cDice, bodyChamfer - p.wall);
	const corners = p.magnets.enabled
		? magnetCorners(outerHalf, bodyChamfer, magRadius, p.wall, p.magnets.count)
		: [];
	const body = octagonPointsPerCorner(
		outerHalf.x,
		outerHalf.y,
		bodyChamfer,
		bodyChamfer,
		bodyChamfer,
		bodyChamfer
	).map(([x, y]) => new Vector2(x, y));
	const inner = recessOctagonPoints(outerHalf, p.wall, recessBase, corners, trayBossR);
	return { bodyChamfer, recessBase, magRadius, trayBossR, corners, body, inner };
}

// One die ready for the 2D layout editor: its rotation-0 hull (rotated live in
// the editor), its laid-flat size, where the auto-layout would place it, and
// whether it's currently included in the box.
export type LayoutDie = {
	dieId: string;
	kind: string;
	hull0: Array<Vector2>;
	size: Vector3;
	autoPos: Vector2;
	include: boolean;
};
export type PreparedLayout = {
	dice: Array<LayoutDie>;
	box: { halfX: number; halfY: number };
};

// Prepare ALL the set's dice for the 2D editor (so it can offer include
// checkboxes for every die): build each once (at rotation 0) to get its
// hull/size, then seed positions + box size from the auto-layout over just the
// included dice. No solids are returned (CSG geometry is disposed).
export async function prepareLayout(set: DiceSet, config: BoxConfig): Promise<PreparedLayout> {
	await getManifold();
	const p = config.params;
	const byId = new Map(config.placements.map((pl) => [pl.dieId, pl]));
	// preserve placement order, with any set-only dice appended.
	const ordered = config.placements
		.filter((pl) => set.dice.some((d) => d.id === pl.dieId))
		.slice()
		.sort((a, b) => a.order - b.order);
	const prepared: Array<{
		dieId: string;
		kind: string;
		rotation: number;
		include: boolean;
		hull0: Array<Vector2>;
		size: Vector3;
	}> = [];
	const dieById = new Map(set.dice.map((d) => [d.id, d]));
	for (const pl of ordered) {
		const die = dieById.get(pl.dieId);
		if (!die) {
			continue;
		}
		const model = dice[die.kind];
		if (!model) {
			continue;
		}
		try {
			const prep = prepareDie(
				model,
				die.parameters,
				die.string_parameters ?? {},
				pl.dieId,
				p.cavityTolerance,
				0
			);
			prepared.push({
				dieId: pl.dieId,
				kind: die.kind,
				rotation: pl.rotation,
				include: pl.include,
				hull0: prep.hull,
				size: prep.size
			});
			prep.cavity.dispose();
			prep.solid.dispose();
		} catch (e) {
			console.warn('box: failed to prepare die for layout', pl.dieId, e);
		}
	}
	// seed positions/box from the auto-layout of the included dice only.
	const auto = deriveAutoLayout(
		prepared
			.filter((d) => d.include)
			.map((d) => ({ dieId: d.dieId, hull: rotateHull(d.hull0, d.rotation) })),
		p
	);
	const diceList: Array<LayoutDie> = prepared.map((d) => {
		const pl = byId.get(d.dieId);
		const stored = p.manual && pl ? new Vector2(pl.x, pl.y) : undefined;
		return {
			dieId: d.dieId,
			kind: d.kind,
			hull0: d.hull0,
			size: d.size,
			autoPos: auto.positions.get(d.dieId) ?? stored ?? new Vector2(0, 0),
			include: d.include
		};
	});
	return { dice: diceList, box: { halfX: auto.outerHalf.x, halfY: auto.outerHalf.y } };
}

export async function buildBox(set: DiceSet, config: BoxConfig): Promise<BuiltBox> {
	await getManifold();
	const p = config.params;

	const placements = config.placements
		.filter((pl) => pl.include)
		.slice()
		.sort((a, b) => a.order - b.order);

	const dieById = new Map(set.dice.map((d) => [d.id, d]));
	const prepared: Array<PreparedDie> = [];
	for (const pl of placements) {
		const die = dieById.get(pl.dieId);
		if (!die) {
			continue;
		}
		const model = dice[die.kind];
		if (!model) {
			continue;
		}
		try {
			prepared.push(
				prepareDie(
					model,
					die.parameters,
					die.string_parameters ?? {},
					pl.dieId,
					p.cavityTolerance,
					pl.rotation
				)
			);
		} catch (e) {
			console.warn('box: failed to prepare die', pl.dieId, e);
		}
	}

	// --- position the dice and size the box --------------------------------
	// Manual mode uses the 2D editor's stored placements + explicit box size; the
	// auto path arranges the dice in rows and fits the octagon to the hull.
	let positions: Map<string, Vector2>;
	let outerHalf: Vector2;
	if (p.manual && p.box.halfX > 0 && p.box.halfY > 0) {
		const byId = new Map(placements.map((pl) => [pl.dieId, pl]));
		positions = new Map();
		for (const prep of prepared) {
			const pl = byId.get(prep.dieId);
			positions.set(prep.dieId, new Vector2(pl?.x ?? 0, pl?.y ?? 0));
		}
		outerHalf = new Vector2(p.box.halfX, p.box.halfY);
	} else {
		const auto = deriveAutoLayout(
			prepared.map((d) => ({ dieId: d.dieId, hull: d.hull })),
			p
		);
		positions = auto.positions;
		outerHalf = auto.outerHalf;
	}

	// the placed dice hull (centred box frame) drives the chamfer + magnet
	// geometry; boxOutline derives the same outlines the editor draws.
	const placedHull: Array<Vector2> = [];
	for (const prep of prepared) {
		const pos = positions.get(prep.dieId) ?? new Vector2(0, 0);
		for (const h of prep.hull) {
			placedHull.push(new Vector2(h.x + pos.x, h.y + pos.y));
		}
	}
	const outline = boxOutline(p, outerHalf, placedHull);
	const { bodyChamfer, recessBase, trayBossR, corners } = outline;

	// the bevel only truncates the bottom edge inward, so the body octagon is the
	// widest footprint.
	const outer = new Vector2(outerHalf.x * 2, outerHalf.y * 2);

	// equal-height halves. Each half must be deep enough for the deepest half-die
	// (mid-point at the seam) and for the magnet bores.
	const maxHalf = prepared.reduce((m, d) => Math.max(m, d.size.z / 2), 0);
	const magDepth = p.magnets.enabled ? p.magnets.thickness + p.magnets.tolerance : 0;
	const half = p.floor + Math.max(maxHalf, magDepth, 1);
	const seam = half; // top face of each printed half = the seam plane.

	// The lid is folded over (180deg about the X/hinge edge) to close, so every
	// lid feature is Y-mirrored relative to the base; that fold maps it back so
	// the dice cavities and magnets meet their partners in the base.
	const lidCorners = corners.map((c) => new Vector2(c.x, -c.y));

	const placedDice: Array<PlacedDie> = [];

	// --- base: lower half of every die, milled from the seam face ----------
	const baseBody = octagonSlab(outerHalf, bodyChamfer, half, p.bevel);
	const baseCutters: Array<Manifold> = [];
	for (const prep of prepared) {
		const pos = positions.get(prep.dieId) ?? new Vector2(0, 0);
		baseCutters.push(sweptCavity(prep.cavity, false, pos.x, pos.y, seam));
		const die = prep.solid.clone();
		placeCentredAtZ(die, pos.x, pos.y, seam);
		placedDice.push({ dieId: prep.dieId, half: 'base', geometry: die });
	}
	if (p.trayDepth > 0) {
		baseCutters.push(
			trayCutter(outerHalf, p.wall, recessBase, p.trayDepth, seam, corners, trayBossR)
		);
	}
	baseCutters.push(...magnetBores(p, corners, seam));
	const base = cutToGeometry(baseBody, baseCutters);

	// --- lid: upper half of every die. The die is rotated 180deg about X so the
	// half that lands in the lid (printed seam-up) is its top; when the lid is
	// flipped closed it mates exactly with the base. ----------------------
	const lidBody = octagonSlab(outerHalf, bodyChamfer, half, p.bevel);
	const lidCutters: Array<Manifold> = [];
	for (const prep of prepared) {
		const pos = positions.get(prep.dieId) ?? new Vector2(0, 0);
		lidCutters.push(sweptCavity(prep.cavity, true, pos.x, -pos.y, seam));
		const die = prep.solid.clone();
		die.rotateX(Math.PI);
		placeCentredAtZ(die, pos.x, -pos.y, seam);
		placedDice.push({ dieId: prep.dieId, half: 'lid', geometry: die });
	}
	if (p.trayDepth > 0) {
		lidCutters.push(
			trayCutter(outerHalf, p.wall, recessBase, p.trayDepth, seam, lidCorners, trayBossR)
		);
	}
	lidCutters.push(...magnetBores(p, lidCorners, seam));
	const lid = cutToGeometry(lidBody, lidCutters);

	// developer boundary overlay outlines (box xy frame, centred on the origin).
	const diceBounds = prepared.map((prep) => {
		const pos = positions.get(prep.dieId) ?? new Vector2(0, 0);
		return prep.hull.map((h) => new Vector2(h.x + pos.x, h.y + pos.y));
	});
	const combinedPts: Array<[number, number]> = [];
	for (const poly of diceBounds) {
		for (const v of poly) {
			combinedPts.push([v.x, v.y]);
		}
	}
	const boundaries: BoxBoundaries = {
		dice: diceBounds,
		combined: convexHull2D(combinedPts).map(([x, y]) => new Vector2(x, y)),
		inner: outline.inner
	};

	prepared.forEach((d) => {
		d.cavity.dispose();
		d.solid.dispose();
	});

	return {
		base,
		lid,
		placedDice,
		outer,
		baseHeight: half,
		lidHeight: half,
		boundaries
	};
}
