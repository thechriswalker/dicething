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

export type BuiltBox = {
	base: BufferGeometry;
	lid: BufferGeometry;
	placedDice: Array<PlacedDie>;
	// outer footprint (x,y) and per-piece heights, for camera framing / info.
	outer: Vector2;
	baseHeight: number;
	lidHeight: number;
};

// A die prepared for the box: its cavity (oversized) and true solids laid flat,
// plus the layout footprint/height.
type PreparedDie = {
	dieId: string;
	cavity: BufferGeometry; // oversized solid, centred xy, bottom at z=0
	solid: BufferGeometry; // true die solid, centred xy, bottom at z=0
	size: Vector3; // cavity size (x,y footprint, z height)
};

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
		size: cavitySize
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
function octagonCSPerCorner(
	hx: number,
	hy: number,
	cpp: number,
	cmp: number,
	cmm: number,
	cpm: number
): CrossSection {
	const wasm = manifold();
	const lim = Math.min(hx, hy) - 0.01;
	const clamp = (c: number) => Math.max(0, Math.min(c, lim));
	const app = clamp(cpp);
	const amp = clamp(cmp);
	const amm = clamp(cmm);
	const apm = clamp(cpm);
	const pts: Array<[number, number]> = [
		[hx, -hy + apm],
		[hx, hy - app],
		[hx - app, hy],
		[-hx + amp, hy],
		[-hx, hy - amp],
		[-hx, -hy + amm],
		[-hx + amm, -hy],
		[hx - apm, -hy]
	];
	return new wasm.CrossSection(pts, 'Positive');
}

// Uniform scale relating the body octagon to one shrunk in by ~`bevel` on its
// perimeter. Used to size the truncated bottom face of the bevelled slab.
function bevelScale(outerHalf: Vector2, bevel: number): number {
	return Math.max(
		(outerHalf.x + bevel) / outerHalf.x,
		(outerHalf.y + bevel) / outerHalf.y
	);
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
// the footprint sizing can rely on it.
export function recessChamfer(
	outerHalf: Vector2,
	chamfer: number,
	wall: number,
	corners: Array<Vector2>,
	bossRadius: number
): number {
	const innerX = Math.max(1, outerHalf.x - wall);
	const innerY = Math.max(1, outerHalf.y - wall);
	let c = Math.max(0, chamfer - wall);
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
function trayCutter(
	outerHalf: Vector2,
	chamfer: number,
	wall: number,
	depth: number,
	seam: number,
	corners: Array<Vector2>,
	bossRadius: number
): Manifold {
	const innerX = Math.max(1, outerHalf.x - wall);
	const innerY = Math.max(1, outerHalf.y - wall);
	const cTight = Math.max(0, chamfer - wall);
	const cMag = recessChamfer(outerHalf, chamfer, wall, corners, bossRadius);
	const corner = (sx: number, sy: number) =>
		corners.some((c) => Math.sign(c.x) === sx && Math.sign(c.y) === sy) ? cMag : cTight;
	const cs = octagonCSPerCorner(
		innerX,
		innerY,
		corner(1, 1),
		corner(-1, 1),
		corner(-1, -1),
		corner(1, -1)
	);
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

	// lay every die out in a single field (they all straddle the seam).
	const items: Array<LayoutItem> = prepared.map((d) => ({
		dieId: d.dieId,
		footprint: new Vector2(d.size.x, d.size.y)
	}));
	const layout = layoutDice(items, p.gap, p.rows);

	// keep a sensible minimum footprint even with no/included dice. The straight
	// edges sit `margin + wall` out from the (half) field rectangle.
	const fieldX = Math.max(layout.field.x, 20);
	const fieldY = Math.max(layout.field.y, 20);
	const outerHalf = new Vector2(fieldX / 2 + p.margin + p.wall, fieldY / 2 + p.margin + p.wall);

	const magRadius = p.magnets.diameter / 2 + p.magnets.tolerance;
	// keep the magnet corners full-height under the shallow interior tray.
	const trayBossR = magRadius + 1.0;
	const cornersFor = (oh: Vector2): Array<Vector2> =>
		p.magnets.enabled ? magnetCorners(oh, p.chamfer, magRadius, p.wall, p.magnets.count) : [];

	// Grow the footprint so the dice field stays inside the chamfered octagon -
	// otherwise dice near the corners overlap the corner truncations. The binding
	// octagon is the interior recess when there is one (its diagonals are pulled
	// well in to clear the magnets), else the body octagon itself. Each diagonal
	// edge x + y = (octHalf.x) + (octHalf.y) - cham must stay `margin` (measured
	// perpendicular, hence * SQRT2 here) clear of the field rectangle's corner;
	// the shortfall in (x + y) is shared equally between the axes, so the box
	// resizes symmetrically. `cham`/`wallInset` are invariant under this growth.
	const wallInset = p.trayDepth > 0 ? p.wall : 0;
	const cham =
		p.trayDepth > 0
			? recessChamfer(outerHalf, p.chamfer, p.wall, cornersFor(outerHalf), trayBossR)
			: p.chamfer;
	const needSum = fieldX / 2 + fieldY / 2 + 2 * wallInset + cham + p.margin * Math.SQRT2;
	const haveSum = outerHalf.x + outerHalf.y;
	const grow = Math.max(0, needSum - haveSum) / 2;
	outerHalf.x += grow;
	outerHalf.y += grow;

	// the bevel only truncates the bottom edge inward, so the body octagon is the
	// widest footprint.
	const outer = new Vector2(outerHalf.x * 2, outerHalf.y * 2);

	// equal-height halves. Each half must be deep enough for the deepest half-die
	// (mid-point at the seam) and for the magnet bores.
	const maxHalf = prepared.reduce((m, d) => Math.max(m, d.size.z / 2), 0);
	const magDepth = p.magnets.enabled ? p.magnets.thickness + p.magnets.tolerance : 0;
	const half = p.floor + Math.max(maxHalf, magDepth, 1);
	const seam = half; // top face of each printed half = the seam plane.

	const corners = cornersFor(outerHalf);
	// The lid is folded over (180deg about the X/hinge edge) to close, so every
	// lid feature is Y-mirrored relative to the base; that fold maps it back so
	// the dice cavities and magnets meet their partners in the base.
	const lidCorners = corners.map((c) => new Vector2(c.x, -c.y));

	const placedDice: Array<PlacedDie> = [];

	// --- base: lower half of every die, milled from the seam face ----------
	const baseBody = octagonSlab(outerHalf, p.chamfer, half, p.bevel);
	const baseCutters: Array<Manifold> = [];
	for (const prep of prepared) {
		const pos = layout.positions.get(prep.dieId) ?? new Vector2(0, 0);
		baseCutters.push(sweptCavity(prep.cavity, false, pos.x, pos.y, seam));
		const die = prep.solid.clone();
		placeCentredAtZ(die, pos.x, pos.y, seam);
		placedDice.push({ dieId: prep.dieId, half: 'base', geometry: die });
	}
	if (p.trayDepth > 0) {
		baseCutters.push(trayCutter(outerHalf, p.chamfer, p.wall, p.trayDepth, seam, corners, trayBossR));
	}
	baseCutters.push(...magnetBores(p, corners, seam));
	const base = cutToGeometry(baseBody, baseCutters);

	// --- lid: upper half of every die. The die is rotated 180deg about X so the
	// half that lands in the lid (printed seam-up) is its top; when the lid is
	// flipped closed it mates exactly with the base. ----------------------
	const lidBody = octagonSlab(outerHalf, p.chamfer, half, p.bevel);
	const lidCutters: Array<Manifold> = [];
	for (const prep of prepared) {
		const pos = layout.positions.get(prep.dieId) ?? new Vector2(0, 0);
		lidCutters.push(sweptCavity(prep.cavity, true, pos.x, -pos.y, seam));
		const die = prep.solid.clone();
		die.rotateX(Math.PI);
		placeCentredAtZ(die, pos.x, -pos.y, seam);
		placedDice.push({ dieId: prep.dieId, half: 'lid', geometry: die });
	}
	if (p.trayDepth > 0) {
		lidCutters.push(
			trayCutter(outerHalf, p.chamfer, p.wall, p.trayDepth, seam, lidCorners, trayBossR)
		);
	}
	lidCutters.push(...magnetBores(p, lidCorners, seam));
	const lid = cutToGeometry(lidBody, lidCutters);

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
		lidHeight: half
	};
}
