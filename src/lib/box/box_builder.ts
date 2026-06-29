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
import type { BoxConfig, BoxHalf, BoxParams, HingeConfig } from './types';

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

// Where a print-in-place hinge ended up, so the preview / export can lay the two
// halves out interlocked (back edges set `partingGap` apart so their barrels are
// coaxial on the seam line) and the fold animation knows the pivot. Absent when
// the box has no hinge.
export type BuiltHinge = {
	// the hinge/fold axis height (= the seam plane).
	axisZ: number;
	// number of knuckle clusters placed across the back edge (1 or 2).
	clusters: number;
	// gap between the two halves along the parting line when laid open flat.
	partingGap: number;
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
	hinge?: BuiltHinge;
};

// Which stage of a build a progress tick belongs to. `prepare` is the per-die
// tessellation loop; `base`/`lid` are the two big CSG passes.
export type BuildPhase = 'prepare' | 'base' | 'lid';

// A single discrete progress tick. `totalSteps` is known up front so a UI can
// pick a fitting indicator immediately; `step` runs 0..totalSteps. `label` is an
// English fallback - a localised UI should prefer `phase` + the step counts.
export type BuildProgress = {
	step: number;
	totalSteps: number;
	phase: BuildPhase;
	label: string;
};

export type ProgressCallback = (p: BuildProgress) => void;

// A die prepared for the box: its cavity (oversized) and true solids laid flat,
// plus the layout footprint/height and the cavity's projected 2D outline.
type PreparedDie = {
	dieId: string;
	cavity: BufferGeometry; // oversized solid, centred xy, bottom at z=0
	// a more-grown cavity (double the tolerance) for the LID half of dice that add a
	// box support: the support fin rises above the seam into the lid's cavity, so the
	// lid needs extra room for it. undefined => the lid uses the normal cavity.
	lidCavity?: BufferGeometry;
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

	// dice with a box support (e.g. the tilted coin) have a fin that rises above the
	// seam into the lid's cavity; build the lid a looser cavity (double the tolerance)
	// so the fin clears it. Only the precise (blankParameters) path supports this.
	let lidCavity: BufferGeometry | undefined;
	if (model.boxSupport && model.blankParameters && cavityTolerance > 0) {
		const lidParams = model.blankParameters(params, -2 * cavityTolerance);
		const lidFaces = model.build(lidParams, stringParams).faces;
		lidCavity = orientDieSolid(model, lidFaces, extraRotation).geometry;
	}

	return {
		dieId,
		cavity,
		lidCavity,
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
// straight up. This is the EDDC case's chamfered outer profile - a 45-degree
// corner truncation of the bottom edge (a printable overhang).
// `topChamfer` breaks the sharp outer edge at the seam (where the two halves
// touch): the body octagon shrinks back in by `topChamfer` over the last
// `topChamfer` of height. The inner part of the seam face stays the body
// octagon so the halves still mate flat - only the outer lip is relieved, which
// makes the closed box easier to prise open. Kept self-similar so the
// truncation reads cleanly at the corners.
function octagonSlab(
	outerHalf: Vector2,
	chamfer: number,
	height: number,
	bevel = 0,
	topChamfer = 0
): Manifold {
	const wasm = manifold();
	const full = octagonCS(outerHalf.x, outerHalf.y, chamfer);
	const b = Math.max(0, Math.min(bevel, height - 0.5));
	const tc = Math.max(0, Math.min(topChamfer, height - b - 0.5));
	if (b <= 0 && tc <= 0) {
		const slab = full.extrude(height);
		full.delete();
		return slab;
	}
	const parts: Array<Manifold> = [];
	if (b > 0) {
		// exterior octagon (z = 0) = body shrunk in by the bevel, growing back out
		// to the body octagon at z = b (self-similar). exterior -> body.
		const s = bevelScale(outerHalf, b);
		const exteriorCS = octagonCS(outerHalf.x / s, outerHalf.y / s, chamfer / s);
		parts.push(exteriorCS.extrude(b, 0, 0, [s, s]));
		exteriorCS.delete();
	}
	// straight body prism between the two chamfers.
	parts.push(full.extrude(height - b - tc).translate([0, 0, b]));
	if (tc > 0) {
		// body shrinking inward to a smaller octagon at the seam (self-similar).
		const st = 1 / bevelScale(outerHalf, tc);
		parts.push(full.extrude(tc, 0, 0, [st, st]).translate([0, 0, height - tc]));
	}
	full.delete();
	let slab = parts[0];
	for (let i = 1; i < parts.length; i++) {
		const u = wasm.Manifold.union(slab, parts[i]);
		deleteAll(slab, parts[i]);
		slab = u;
	}
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

// Small 45-degree relief on the outer edge of each half's seam face. Both halves
// carry it, so the closed box has a shallow V-groove around the parting line:
// breaks the sharp edge and gives a fingernail purchase for opening.
const SEAM_CHAMFER = 1;

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

// --- print-in-place knuckle hinge -------------------------------------------
// The hinge runs along the +y back edge at the seam plane (z = seam). Each half
// keeps its body almost full; only a thin strip of the flat back edge is shaved
// off so the two halves don't fuse along the parting line when printed open and
// flat. Barrel bulbs (radius `barrelR`) are centred on the seam line, anchored
// into the body, and the two sets of knuckles interleave along x: the base
// carries the two outer (solid) knuckles with the pin/bar running between them,
// and the lid carries the inner knuckle(s), bored to thread onto that bar. Each
// half is relieved where the *other* half's knuckle intrudes, so nothing fuses
// and the joint spins. A hinged box is laid out with both back edges meeting on
// the seam line (barrels coaxial), so the lid folds 180deg about it to close.
//
// Matching the EDDC knuckle (confirmed against EDDC_Blanc.stl):
//   - Each knuckle is a plain ROUND barrel centred on the seam line; its lower
//     half is buried in the body and its upper half is the visible round bump.
//     Printed open and flat, both halves rest on the bed and the two rows of
//     barrels interleave coaxially across the parting gap.
//   - The "teardrop" look in the reference is not the barrel itself: it is the
//     parting gap between the two halves, which is tight at the pin and opens
//     into a V toward the bed (the bevelled bottom edges), plus the inner-seam
//     indent below - so each half reads as a round bump with a tapering gap.
//   - Inner-seam indent: a 45-degree chamfer on each half's inner-wall/seam edge
//     behind the knuckles, relieving the corner the opposing barrel sweeps so the
//     lid can open all the way flat.

// nominal axial length budget per knuckle; the print-in-place gap is taken out
// of this so neighbouring base/lid knuckles don't touch.
const HINGE_KNUCKLE_PITCH = 4;
// the smallest a knuckle band may shrink to (when the flat edge is short) before
// we drop the knuckle count instead.
const HINGE_MIN_PITCH = 1.4;
// keep clusters this far in from the ends of the straight back-edge run, so a
// barrel never lands on the chamfered corner (where the edge is pulled inward).
const HINGE_END_MARGIN = 1.5;
// flat run to spare between two clusters before splitting into two.
const HINGE_CLUSTER_GAP = 12;
// how far the barrel reaches into the body below the seam (anchor overlap).
const HINGE_BODY_OVERLAP = 1;
// smallest parting gap between the two halves when open, used when the wall is
// thick relative to the barrel (otherwise the gap is sized so the barrel's inner
// face lands flush on the inner wall - see buildHinge).
const HINGE_MIN_PARTING_GAP = 1;
const HINGE_SEGMENTS = 48;

type ResolvedHinge = {
	clearance: number;
	barrelR: number;
	pinR: number;
	knuckles: number;
	// 45-degree opening-clearance chamfer leg on each half's inner-wall/seam edge.
	indent: number;
};

// Clamp the (dev-tunable, EDDC-scaled) hinge dimensions to a given seam height:
// the barrel's lower half must fit below the seam, and the pin must leave a
// printable wall inside the barrel.
function resolveHinge(h: HingeConfig, seam: number): ResolvedHinge {
	const clearance = h.clearance > 0 ? h.clearance : 0.35;
	let barrelR = h.barrelRadius > 0 ? h.barrelRadius : 3.4;
	let pinR = h.pinRadius > 0 ? h.pinRadius : 1.6;
	// at least 3 knuckles so the pin is captured by >= 2 base barrels.
	const knuckles = Math.max(3, Math.round(h.knuckles > 0 ? h.knuckles : 3));
	barrelR = Math.max(1.5, Math.min(barrelR, seam - HINGE_BODY_OVERLAP - 0.5));
	pinR = Math.max(0.8, Math.min(pinR, barrelR - clearance - 0.8));
	const indentReq = h.indent >= 0 ? h.indent : 1.2;
	const indent = Math.max(0, Math.min(indentReq, seam - 0.5));
	return { clearance, barrelR, pinR, knuckles, indent };
}

export type HingeCluster = { centerX: number; length: number };

// Choose 1 or 2 knuckle clusters across the straight part of the back edge (the
// octagon's +y run, between its truncated corners). Two clusters once the edge
// fits both with a sensible gap; otherwise a single centred cluster. Capped at 2.
export function chooseHingeClusters(
	outerHalf: Vector2,
	bodyChamfer: number,
	knuckles: number
): Array<HingeCluster> {
	const flatHalf = Math.max(0, outerHalf.x - bodyChamfer);
	// usable straight run, keeping a margin off each chamfered corner.
	const avail = flatHalf * 2 - 2 * HINGE_END_MARGIN;
	const targetLen = Math.max(3, Math.round(knuckles)) * HINGE_KNUCKLE_PITCH;
	if (avail >= 2 * targetLen + HINGE_CLUSTER_GAP) {
		// centre the two clusters on the quarter / three-quarter points of the
		// straight run, so they sit well apart near the box's shoulders.
		const cx = avail / 4;
		return [
			{ centerX: -cx, length: targetLen },
			{ centerX: cx, length: targetLen }
		];
	}
	const length = Math.max(3, Math.min(targetLen, avail));
	return [{ centerX: 0, length }];
}

// A cylinder whose axis runs along X, centred at (cx, y, z).
function xCylinder(r: number, length: number, cx: number, y: number, z: number): Manifold {
	const wasm = manifold();
	return wasm.Manifold.cylinder(length, r, r, HINGE_SEGMENTS, true)
		.rotate([0, 90, 0])
		.translate([cx, y, z]);
}

// Signed area of a 2D polygon (CCW positive).
function signedArea(pts: Array<[number, number]>): number {
	let a = 0;
	for (let i = 0; i < pts.length; i++) {
		const [x1, y1] = pts[i];
		const [x2, y2] = pts[(i + 1) % pts.length];
		a += x1 * y2 - x2 * y1;
	}
	return a / 2;
}

// Extrude a y-z cross-section (points given as [z, y]) into a prism whose axis
// runs along X, centred at x = cx and spanning `length`. The CrossSection lives
// in its local xy plane and extrudes along +z; rotating by -90deg about Y maps
// local x -> world +z, local y -> world y, and the extrude axis -> world -x. So
// the supplied [z, y] coordinates land directly in the world z/y they name.
function xPrismZY(pointsZY: Array<[number, number]>, length: number, cx: number): Manifold {
	const wasm = manifold();
	const pts = signedArea(pointsZY) < 0 ? pointsZY.slice().reverse() : pointsZY;
	const cs = new wasm.CrossSection(pts, 'Positive');
	const solid = cs
		.extrude(length)
		.translate([0, 0, -length / 2])
		.rotate([0, -90, 0])
		.translate([cx, 0, 0]);
	cs.delete();
	return solid;
}

// The (y,z) outline of a knuckle: a FULL round circle of radius R centred at
// (ay, S), kept completely round, with a tapering support tail ADDED below it.
// The tail's two flanks are the straight tangent lines from the circle down to
// the apex (apexY, apexZ), where they meet at a single point. With the apex at
// the box's back-wall foot (where the bottom bevel begins) the tail leans back
// and dies flush into the wall (rather than dropping straight into the parting
// gap), so the elevated barrel is braced off the wall and prints with no
// overhang under it - matching the EDDC support. Needs the apex outside the
// circle. Returned as [z, y] pairs.
function teardropPolygonZY(
	ay: number,
	S: number,
	R: number,
	apexY: number,
	apexZ: number
): Array<[number, number]> {
	// tangent points from the external apex A=(apexY,apexZ) to the circle O=(ay,S).
	const wy = apexY - ay;
	const wz = apexZ - S;
	const L2 = wy * wy + wz * wz;
	const f1 = (R * R) / L2;
	const f2 = (R * Math.sqrt(Math.max(1e-9, L2 - R * R))) / L2;
	// perp(w) = (-wz, wy)
	const t1 = { y: ay + f1 * wy + f2 * -wz, z: S + f1 * wz + f2 * wy };
	const t2 = { y: ay + f1 * wy - f2 * -wz, z: S + f1 * wz - f2 * wy };
	const tPos = t1.y >= t2.y ? t1 : t2; // tangent on the +y (overhang) flank
	const tNeg = t1.y >= t2.y ? t2 : t1;
	const aPos = Math.atan2(tPos.z - S, tPos.y - ay);
	const aNeg = Math.atan2(tNeg.z - S, tNeg.y - ay);
	// walk the MAJOR arc from tPos to tNeg (over the top, away from the apex).
	let diff = aNeg - aPos;
	while (diff <= 0) diff += 2 * Math.PI; // 0..2pi, the arc going over the top
	// a single apex vertex: the tail tapers to a point at the wall foot (flush
	// with the wall/bevel) rather than a small flat that would overshoot it.
	const pts: Array<[number, number]> = [[apexZ, apexY]];
	pts.push([tPos.z, tPos.y]);
	const n = HINGE_SEGMENTS;
	for (let i = 1; i < n; i++) {
		const phi = aPos + (i / n) * diff;
		pts.push([S + R * Math.sin(phi), ay + R * Math.cos(phi)]);
	}
	pts.push([tNeg.z, tNeg.y]);
	return pts;
}

// A round knuckle barrel (radius R) braced by a self-supporting tail that leans
// back to the apex (apexY, apexZ) - the foot of the box's vertical wall, where
// its bottom bevel begins, so the tail dies into the wall instead of poking past
// the bevelled footprint. See teardropPolygonZY. Falls back to a plain cylinder
// if the barrel is too tall to leave room for the tail.
function teardropBarrel(
	R: number,
	length: number,
	cx: number,
	ay: number,
	S: number,
	apexY: number,
	apexZ: number
): Manifold {
	const wy = apexY - ay;
	const wz = apexZ - S;
	if (R >= S - 0.1 || wy * wy + wz * wz <= (R + 0.1) * (R + 0.1)) {
		return xCylinder(R, length, cx, ay, S);
	}
	return xPrismZY(teardropPolygonZY(ay, S, R, apexY, apexZ), length, cx);
}

type HingeSolids = {
	// applied to BOTH halves (each in its own frame): cutters then adds.
	baseCutters: Array<Manifold>;
	baseAdds: Array<Manifold>;
	lidCutters: Array<Manifold>;
	lidAdds: Array<Manifold>;
	clusters: number;
	partingGap: number;
};

// Build the hinge manifolds for both halves (EDDC layout): the base carries the
// outer knuckles (solid barrels) with the pin/bar running between them, so the
// ends are closed; the lid carries the inner knuckle(s), bored to wrap the bar.
// The barrel axis sits half a parting gap beyond each back edge, so once the lid
// is laid out folded-open (its back edge `partingGap` from the base's) the two
// are coaxial on the seam line and the lid knuckles thread onto the base bar.
function buildHinge(
	h: HingeConfig,
	outerHalf: Vector2,
	bodyChamfer: number,
	wall: number,
	seam: number,
	bevel: number
): HingeSolids {
	const wasm = manifold();
	const { clearance, barrelR, pinR, knuckles, indent } = resolveHinge(h, seam);
	// the support tail dies into the foot of the vertical wall - i.e. the height
	// where the body's bottom bevel begins - so it never pokes past the bevelled
	// bottom footprint. (The bevel itself then carries the body down to the bed.)
	const tailZ = Math.max(0, Math.min(bevel, seam - 0.5));
	const clusters = chooseHingeClusters(outerHalf, bodyChamfer, knuckles);
	// the barrel axis sits half a parting gap beyond the back edge; choosing the
	// gap = 2*(barrelR - wall) lands the barrel's inner surface flush on the inner
	// wall (tangent, so the wall flows smoothly up into the barrel) and gives a
	// full-`wall` anchor overlap. Floored so a thick wall still leaves a gap.
	const gapHalf = Math.max(HINGE_MIN_PARTING_GAP / 2, barrelR - wall);
	const partingGap = gapHalf * 2;
	const baseY = outerHalf.y + gapHalf;
	const lidY = -baseY;
	const boreR = pinR + clearance;
	// the opposing knuckle is relieved by a round bore of barrelR + clearance so
	// the barrel spins freely once the joint is closed.
	const reliefR = barrelR + clearance;
	const innerWallY = Math.max(1, outerHalf.y - wall);

	const baseCutters: Array<Manifold> = [];
	const baseAdds: Array<Manifold> = [];
	const lidCutters: Array<Manifold> = [];
	const lidAdds: Array<Manifold> = [];

	for (const cl of clusters) {
		// inner-seam clearance chamfer behind this cluster: a 45deg bevel on the
		// inner-wall/seam edge (running a touch wider than the cluster), so the
		// opposing barrel can swing through the corner and the lid opens flat.
		if (indent > 0) {
			const span = cl.length + 2 * HINGE_END_MARGIN;
			baseCutters.push(
				xPrismZY(
					[
						[seam, innerWallY],
						[seam, innerWallY + indent],
						[seam - indent, innerWallY]
					],
					span,
					cl.centerX
				)
			);
			lidCutters.push(
				xPrismZY(
					[
						[seam, -innerWallY],
						[seam, -innerWallY - indent],
						[seam - indent, -innerWallY]
					],
					span,
					cl.centerX
				)
			);
		}
		// drop the knuckle count if the cluster is too short to hold them all at a
		// printable pitch, and keep it ODD so both end knuckles are base (solid,
		// closed ends) with the lid knuckle(s) on the inside.
		let n = Math.max(3, Math.min(knuckles, Math.floor(cl.length / HINGE_MIN_PITCH)));
		if (n % 2 === 0) {
			n -= 1;
		}
		n = Math.max(3, n);
		const bw = cl.length / n;
		const center = (i: number) => cl.centerX - cl.length / 2 + (i + 0.5) * bw;

		// the bar runs between the centres of the outermost base knuckles.
		const pinFrom = center(0);
		const pinTo = center(n - 1);
		const pinMid = (pinFrom + pinTo) / 2;
		const pinLen = pinTo - pinFrom;
		baseAdds.push(xCylinder(pinR, pinLen, pinMid, baseY, seam));
		// clear the bar from the lid along its whole span (the gaps between the
		// lid's bored knuckles still have the bar passing through them).
		lidCutters.push(xCylinder(boreR, pinLen + 1, pinMid, lidY, seam));

		for (let i = 0; i < n; i++) {
			const c = center(i);
			const knuckleW = Math.max(0.6, bw - clearance);
			const reliefW = bw + clearance;
			if (i % 2 === 0) {
				// outer / base knuckle: a SOLID round barrel fused to the bar, braced
				// to the bed by a tail leaning back to the base's wall foot; the lid is
				// relieved here (same teardrop, grown by clearance) so it has room.
				baseAdds.push(teardropBarrel(barrelR, knuckleW, c, baseY, seam, outerHalf.y, tailZ));
				lidCutters.push(teardropBarrel(reliefR, reliefW, c, lidY, seam, -outerHalf.y, tailZ));
			} else {
				// inner / lid knuckle: a bored round barrel (also tailed back to the
				// lid's wall foot) that wraps the bar; the base is relieved here.
				const barrel = teardropBarrel(barrelR, knuckleW, c, lidY, seam, -outerHalf.y, tailZ);
				const bore = xCylinder(boreR, knuckleW + 1, c, lidY, seam);
				const tube = wasm.Manifold.difference(barrel, bore);
				deleteAll(barrel, bore);
				lidAdds.push(tube);
				baseCutters.push(teardropBarrel(reliefR, reliefW, c, baseY, seam, outerHalf.y, tailZ));
			}
		}
	}
	return { baseCutters, baseAdds, lidCutters, lidAdds, clusters: clusters.length, partingGap };
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
function cutToGeometry(
	base: Manifold,
	cutters: Array<Manifold>,
	adds: Array<Manifold> = []
): BufferGeometry {
	const wasm = manifold();
	let solid = base;
	if (cutters.length > 0) {
		const union = wasm.Manifold.union(cutters);
		const diff = wasm.Manifold.difference(solid, union);
		deleteAll(solid, union, ...cutters);
		solid = diff;
	}
	if (adds.length > 0) {
		const union = wasm.Manifold.union(adds);
		const merged = wasm.Manifold.union(solid, union);
		deleteAll(solid, union, ...adds);
		solid = merged;
	}
	const cleaned = solid.simplify(CLEAN_TOLERANCE);
	const geo = manifoldToGeometry(cleaned);
	deleteAll(solid, cleaned);
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
	// the diagonal corner face is 45deg, so to keep a full perpendicular `wall` of
	// material there (not the thinner wall/SQRT2 a plain `- wall` leaves) the
	// recess chamfer must be inset by wall*(2 - SQRT2) from the body chamfer.
	const recessBase = Math.max(cDice, bodyChamfer - p.wall * (2 - Math.SQRT2));
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
	const recessBase = Math.max(cDice, bodyChamfer - p.wall * (2 - Math.SQRT2));
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
export async function prepareLayout(
	set: DiceSet,
	config: BoxConfig,
	onProgress?: ProgressCallback
): Promise<PreparedLayout> {
	await getManifold();
	const p = config.params;
	const byId = new Map(config.placements.map((pl) => [pl.dieId, pl]));
	// preserve placement order, with any set-only dice appended.
	const ordered = config.placements
		.filter((pl) => set.dice.some((d) => d.id === pl.dieId))
		.slice()
		.sort((a, b) => a.order - b.order);
	const totalSteps = ordered.length;
	onProgress?.({ step: 0, totalSteps, phase: 'prepare', label: 'Preparing dice' });
	const prepared: Array<{
		dieId: string;
		kind: string;
		rotation: number;
		include: boolean;
		hull0: Array<Vector2>;
		size: Vector3;
	}> = [];
	const dieById = new Map(set.dice.map((d) => [d.id, d]));
	for (let i = 0; i < ordered.length; i++) {
		const pl = ordered[i];
		const die = dieById.get(pl.dieId);
		const model = die ? dice[die.kind] : undefined;
		if (die && model) {
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
				prep.lidCavity?.dispose();
				prep.solid.dispose();
			} catch (e) {
				console.warn('box: failed to prepare die for layout', pl.dieId, e);
			}
		}
		onProgress?.({
			step: i + 1,
			totalSteps,
			phase: 'prepare',
			label: `Preparing die ${i + 1}/${ordered.length}`
		});
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

export async function buildBox(
	set: DiceSet,
	config: BoxConfig,
	onProgress?: ProgressCallback
): Promise<BuiltBox> {
	await getManifold();
	const p = config.params;

	const placements = config.placements
		.filter((pl) => pl.include)
		.slice()
		.sort((a, b) => a.order - b.order);

	// prepare each die (N steps) then cut the base and the lid (2 steps).
	const totalSteps = placements.length + 2;
	onProgress?.({ step: 0, totalSteps, phase: 'prepare', label: 'Preparing dice' });

	const dieById = new Map(set.dice.map((d) => [d.id, d]));
	const prepared: Array<PreparedDie> = [];
	for (let i = 0; i < placements.length; i++) {
		const pl = placements[i];
		const die = dieById.get(pl.dieId);
		if (die) {
			const model = dice[die.kind];
			if (model) {
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
		}
		onProgress?.({
			step: i + 1,
			totalSteps,
			phase: 'prepare',
			label: `Preparing die ${i + 1}/${placements.length}`
		});
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
	const { bodyChamfer, recessBase, trayBossR } = outline;
	// a hinged box only needs magnets on the opening side, and a magnet bore in a
	// hinge-side corner clashes with the knuckles. magnetCorners orders the
	// opening pair first, so clamp to it when hinged.
	const corners =
		p.hinge.enabled && outline.corners.length > 2 ? outline.corners.slice(0, 2) : outline.corners;

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

	// print-in-place hinge along the +y back edge (built into both halves below).
	const hinge = p.hinge.enabled
		? buildHinge(p.hinge, outerHalf, bodyChamfer, p.wall, seam, p.bevel)
		: undefined;

	const placedDice: Array<PlacedDie> = [];

	// --- base: lower half of every die, milled from the seam face ----------
	const baseBody = octagonSlab(outerHalf, bodyChamfer, half, p.bevel, SEAM_CHAMFER);
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
	if (hinge) {
		baseCutters.push(...hinge.baseCutters);
	}

	// positive supports for steeply tilted dice (e.g. the coin). The model returns
	// geometry in its rotation-0 laid-flat XY frame / global box Z; spin it to the
	// die's box rotation and move it onto the die's (x, y), then union it into the
	// base. The fin rises above the seam into the lid's coin cavity, which is grown
	// extra (see lidCavity in prepareDie) so the fin fits inside it.
	const placeById = new Map(placements.map((pl) => [pl.dieId, pl]));
	const baseSupports: Array<Manifold> = [];
	for (const prep of prepared) {
		const die = dieById.get(prep.dieId);
		const model = die ? dice[die.kind] : undefined;
		if (!die || !model?.boxSupport) {
			continue;
		}
		const pos = positions.get(prep.dieId) ?? new Vector2(0, 0);
		const rot = placeById.get(prep.dieId)?.rotation ?? 0;
		// pass the same cavity tolerance the die's cavity was grown by, so the
		// support's top surface coincides with the cavity floor (a seamless indent).
		const g = model.boxSupport(die.parameters, die.string_parameters ?? {}, {
			seam,
			floor: p.floor,
			cavityTolerance: p.cavityTolerance
		});
		if (g) {
			if (rot) {
				g.rotateZ(rot);
			}
			g.translate(pos.x, pos.y, 0);
			baseSupports.push(geometryToManifold(g));
			g.dispose();
		}
	}
	if (hinge) {
		baseSupports.push(...hinge.baseAdds);
	}
	onProgress?.({
		step: placements.length + 1,
		totalSteps: placements.length + 2,
		phase: 'base',
		label: 'Cutting base'
	});
	const base = cutToGeometry(baseBody, baseCutters, baseSupports);

	// --- lid: upper half of every die. The die is rotated 180deg about X so the
	// half that lands in the lid (printed seam-up) is its top; when the lid is
	// flipped closed it mates exactly with the base. ----------------------
	const lidBody = octagonSlab(outerHalf, bodyChamfer, half, p.bevel, SEAM_CHAMFER);
	const lidCutters: Array<Manifold> = [];
	for (const prep of prepared) {
		const pos = positions.get(prep.dieId) ?? new Vector2(0, 0);
		lidCutters.push(sweptCavity(prep.lidCavity ?? prep.cavity, true, pos.x, -pos.y, seam));
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
	const lidAdds: Array<Manifold> = [];
	if (hinge) {
		lidCutters.push(...hinge.lidCutters);
		lidAdds.push(...hinge.lidAdds);
	}
	onProgress?.({
		step: placements.length + 2,
		totalSteps: placements.length + 2,
		phase: 'lid',
		label: 'Cutting lid'
	});
	const lid = cutToGeometry(lidBody, lidCutters, lidAdds);

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
		d.lidCavity?.dispose();
		d.solid.dispose();
	});

	return {
		base,
		lid,
		placedDice,
		outer,
		baseHeight: half,
		lidHeight: half,
		boundaries,
		hinge: hinge
			? { axisZ: seam, clusters: hinge.clusters, partingGap: hinge.partingGap }
			: undefined
	};
}
