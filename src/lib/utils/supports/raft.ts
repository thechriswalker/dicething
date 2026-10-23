// One raft for every pillar, not a pad under each.
//
// The top outline is the convex hull of the pillar footprints, grown by the
// raft margin. The rim slopes out toward that top at 45° to the plate, so the
// base is the same outline inset by the raft thickness and a scraper can get
// under the lip. A fixed honeycomb of hexagonal holes is cut through the
// interior. Pillars run down to the plate on their own. A pillar that is not
// firmly biting into a vent wall gets a web to that wall. Two pillars whose
// surfaces nearly touch have the slot between them filled. A longer run is not
// hulled, so the vents enclosed by a ring of supports stay open.

import { deleteAll, manifold, mapOwned, type CrossSection, type Manifold } from '../manifold';
import { RAFT_WALL_FROM_PLATE_DEG } from './types';

export type RaftFoot = {
	x: number;
	z: number;
	/** Pillar (or tip-post) radius. The hull wraps these circles. */
	radius: number;
};

/** Flat-to-flat size of each vent, and the web left between vents. */
export const RAFT_HOLE_FLAT_MM = 2.5;
export const RAFT_HOLE_WALL_MM = 1.0;

const HOLE_CIRCUMRADIUS = RAFT_HOLE_FLAT_MM / Math.sqrt(3);
const HOLE_APOTHEM = RAFT_HOLE_FLAT_MM / 2;
// Neighbours sit along the flat normals (30° + k·60°), one flat-to-flat apart.
const HOLE_SPACING = RAFT_HOLE_FLAT_MM + RAFT_HOLE_WALL_MM;
// Surface gap worth closing. Only that pair is filled; chaining every
// neighbour and taking the convex hull would pave the inside of the raft.
const PILLAR_GAP_FILL_MM = 0.8;
// A pillar must overlap the vent wall by this much to count as anchored.
// Anything less is still freestanding and gets a web.
const MIN_WALL_BITE_MM = 0.4;
const BRIDGE_MIN_RADIUS_MM = 0.6;

/** Centre of honeycomb cell (col, row). The lattice is fixed in world XZ. */
export function raftHoleCenter(col: number, row: number): { x: number; z: number } {
	const cs = holeCenterCs(col, row);
	return { x: cs.x, z: -cs.y };
}

function holeCenterCs(col: number, row: number): { x: number; y: number } {
	// Basis: 30° and 90°, each HOLE_SPACING long. Equivalent to the
	// circumradius lattice when spacing equals the flat-to-flat of a
	// touching pair; the extra wall is baked into HOLE_SPACING.
	const scale = HOLE_SPACING / RAFT_HOLE_FLAT_MM;
	const R = HOLE_CIRCUMRADIUS * scale;
	return {
		x: col * 1.5 * R,
		y: col * ((R * Math.sqrt(3)) / 2) + row * R * Math.sqrt(3)
	};
}

function hexPolygon(cx: number, cy: number, radius: number): Array<[number, number]> {
	const pts: Array<[number, number]> = [];
	for (let k = 0; k < 6; k++) {
		const angle = (k * Math.PI) / 3;
		pts.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
	}
	return pts;
}

function polygonContains(poly: Array<[number, number]>, x: number, y: number): boolean {
	let sign = 0;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
		if (Math.abs(cross) <= 1e-7) {
			continue;
		}
		const s = cross > 0 ? 1 : -1;
		if (sign === 0) {
			sign = s;
		} else if (s !== sign) {
			return false;
		}
	}
	return true;
}

/** Closest point on the hex boundary, and the clearance from `px,py` to that edge. */
function nearestHexWall(
	px: number,
	py: number,
	hx: number,
	hy: number
): { x: number; y: number; clearance: number } {
	const dx = px - hx;
	const dy = py - hy;
	let best = -Infinity;
	let nx = 1;
	let ny = 0;
	for (let k = 0; k < 6; k++) {
		const angle = Math.PI / 6 + (k * Math.PI) / 3;
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		const proj = dx * c + dy * s;
		if (proj > best) {
			best = proj;
			nx = c;
			ny = s;
		}
	}
	const tx = -ny;
	const ty = nx;
	const along = dx * tx + dy * ty;
	const halfEdge = HOLE_CIRCUMRADIUS / 2;
	const clamped = Math.max(-halfEdge, Math.min(halfEdge, along));
	return {
		x: hx + nx * HOLE_APOTHEM + tx * clamped,
		y: hy + ny * HOLE_APOTHEM + ty * clamped,
		clearance: HOLE_APOTHEM - best
	};
}

function closePairs(feet: Array<RaftFoot>): Array<[number, number]> {
	const pairs: Array<[number, number]> = [];
	for (let i = 0; i < feet.length; i++) {
		for (let j = i + 1; j < feet.length; j++) {
			const dist = Math.hypot(feet[i].x - feet[j].x, feet[i].z - feet[j].z);
			if (dist < feet[i].radius + feet[j].radius + PILLAR_GAP_FILL_MM) {
				pairs.push([i, j]);
			}
		}
	}
	return pairs;
}

function distanceToSegment(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number
): number {
	const abx = bx - ax;
	const aby = by - ay;
	const len2 = abx * abx + aby * aby;
	if (len2 <= 1e-12) {
		return Math.hypot(px - ax, py - ay);
	}
	const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
	return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

type LocalMember = {
	index: number;
	wall: { x: number; y: number; clearance: number };
	anchored: boolean;
};

/** Pillars whose circle meets this vent, and whether they already bite its wall. */
function membersInHole(feet: Array<RaftFoot>, cx: number, cy: number): Array<LocalMember> {
	const members: Array<LocalMember> = [];
	for (let index = 0; index < feet.length; index++) {
		const foot = feet[index];
		const wall = nearestHexWall(foot.x, -foot.z, cx, cy);
		if (wall.clearance <= -foot.radius) {
			continue;
		}
		members.push({
			index,
			wall,
			anchored: foot.radius - wall.clearance >= MIN_WALL_BITE_MM
		});
	}
	return members;
}

function groupMembers(
	members: Array<LocalMember>,
	pairs: Array<[number, number]>
): Array<Array<LocalMember>> {
	const present = new Map(members.map((member) => [member.index, member]));
	const parent = new Map(members.map((member) => [member.index, member.index]));
	const find = (index: number): number => {
		let root = index;
		while (parent.get(root) !== root) {
			root = parent.get(root)!;
		}
		return root;
	};
	for (const [a, b] of pairs) {
		if (!present.has(a) || !present.has(b)) {
			continue;
		}
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) {
			parent.set(ra, rb);
		}
	}
	const groups = new Map<number, Array<LocalMember>>();
	for (const member of members) {
		const root = find(member.index);
		const group = groups.get(root);
		if (group) {
			group.push(member);
		} else {
			groups.set(root, [member]);
		}
	}
	return [...groups.values()];
}

function hullOfFeet(feet: Array<RaftFoot>, indices: Array<number>): CrossSection {
	const wasm = manifold();
	const circles = indices.map((index) => {
		const foot = feet[index];
		const circle = wasm.CrossSection.circle(Math.max(0.05, foot.radius), 12);
		const moved = circle.translate([foot.x, -foot.z]);
		circle.delete();
		return moved;
	});
	const hulled = wasm.CrossSection.hull(circles);
	for (const circle of circles) {
		circle.delete();
	}
	return hulled;
}

/** Stadium from a pillar footprint out to a point on the vent wall. */
function bridgeToWall(
	shape: CrossSection,
	wall: { x: number; y: number },
	width: number
): CrossSection {
	const wasm = manifold();
	const disk = wasm.CrossSection.circle(Math.max(0.2, width), 12);
	const moved = disk.translate([wall.x, wall.y]);
	disk.delete();
	const hulled = wasm.CrossSection.hull([shape, moved]);
	moved.delete();
	return hulled;
}

function largestLoop(section: CrossSection): Array<[number, number]> | undefined {
	const loops = section.toPolygons();
	let best: Array<[number, number]> | undefined;
	let bestArea = 0;
	for (const loop of loops) {
		let area = 0;
		for (let i = 0; i < loop.length; i++) {
			const a = loop[i];
			const b = loop[(i + 1) % loop.length];
			area += a[0] * b[1] - b[0] * a[1];
		}
		const abs = Math.abs(area);
		if (abs > bestArea) {
			bestArea = abs;
			best = loop;
		}
	}
	return best;
}

/** Drafted, vented raft. `margin` is how far the top extends past the pillar hull. */
export function buildSupportRaft(
	feet: Array<RaftFoot>,
	depth: number,
	margin: number
): Manifold | undefined {
	if (feet.length === 0 || !(depth > 1e-6) || !(margin > 1e-6)) {
		return undefined;
	}
	const wasm = manifold();
	const owned: Array<CrossSection> = [];
	const keep = (section: CrossSection) => {
		owned.push(section);
		return section;
	};
	const drop = (section: CrossSection) => {
		const index = owned.lastIndexOf(section);
		if (index >= 0) {
			owned.splice(index, 1);
		}
		section.delete();
	};

	try {
		const circles: Array<CrossSection> = [];
		for (const foot of feet) {
			const radius = Math.max(0.05, foot.radius);
			const circle = wasm.CrossSection.circle(radius, 16);
			circles.push(keep(circle.translate([foot.x, -foot.z])));
			circle.delete();
		}
		const united = keep(wasm.CrossSection.union(circles));
		const hulled = keep(united.hull());
		const draft = depth / Math.tan((RAFT_WALL_FROM_PLATE_DEG * Math.PI) / 180);
		// Inset stops at the pillar hull, so a thick raft cannot slope past the columns.
		const baseMargin = Math.max(0, margin - draft);
		const top = keep(hulled.offset(margin, 'Miter'));
		const base = keep(hulled.offset(baseMargin, 'Miter'));
		if (top.isEmpty() || base.isEmpty()) {
			return undefined;
		}
		const topLoop = largestLoop(top);
		const baseLoop = largestLoop(base);
		if (!topLoop || !baseLoop) {
			return undefined;
		}

		const points: Array<[number, number, number]> = [];
		for (const [x, y] of baseLoop) {
			points.push([x, 0, -y]);
		}
		for (const [x, y] of topLoop) {
			points.push([x, depth, -y]);
		}
		const raft = wasm.Manifold.hull(points);

		const interior = keep(base.offset(-Math.min(0.4, baseMargin * 0.5 + 0.2), 'Miter'));
		const interiorLoop = interior.isEmpty() ? undefined : largestLoop(interior);
		const pairs = closePairs(feet);
		const cutters: Array<Manifold> = [];
		if (interiorLoop) {
			const bounds = interior.bounds();
			const scale = HOLE_SPACING / RAFT_HOLE_FLAT_MM;
			const stepX = 1.5 * HOLE_CIRCUMRADIUS * scale;
			const col0 = Math.floor(bounds.min[0] / stepX) - 1;
			const col1 = Math.ceil(bounds.max[0] / stepX) + 1;
			const rowStep = HOLE_CIRCUMRADIUS * scale * Math.sqrt(3);
			const row0 = Math.floor(bounds.min[1] / rowStep) - 2;
			const row1 = Math.ceil(bounds.max[1] / rowStep) + 2;
			for (let col = col0; col <= col1; col++) {
				for (let row = row0; row <= row1; row++) {
					const center = holeCenterCs(col, row);
					const outline = hexPolygon(center.x, center.y, HOLE_CIRCUMRADIUS + 0.25);
					if (!outline.every(([x, y]) => polygonContains(interiorLoop, x, y))) {
						continue;
					}
					let hole: CrossSection = keep(
						new wasm.CrossSection([hexPolygon(center.x, center.y, HOLE_CIRCUMRADIUS)])
					);
					const apply = (plug: CrossSection) => {
						if (hole.isEmpty()) {
							drop(plug);
							return;
						}
						const opened = hole.subtract(plug);
						drop(plug);
						drop(hole);
						hole = keep(opened);
					};
					for (const [i, j] of pairs) {
						const a = feet[i];
						const b = feet[j];
						const reach = HOLE_CIRCUMRADIUS + Math.max(a.radius, b.radius);
						if (distanceToSegment(center.x, center.y, a.x, -a.z, b.x, -b.z) > reach) {
							continue;
						}
						apply(hullOfFeet(feet, [i, j]));
					}
					for (const group of groupMembers(membersInHole(feet, center.x, center.y), pairs)) {
						if (group.some((member) => member.anchored)) {
							continue;
						}
						let closest = group[0];
						for (const member of group) {
							if (member.wall.clearance < closest.wall.clearance) {
								closest = member;
							}
						}
						const foot = feet[closest.index];
						const circle = wasm.CrossSection.circle(Math.max(0.05, foot.radius), 12);
						const moved = circle.translate([foot.x, -foot.z]);
						circle.delete();
						const plug = bridgeToWall(
							moved,
							closest.wall,
							Math.max(foot.radius, BRIDGE_MIN_RADIUS_MM)
						);
						moved.delete();
						apply(plug);
					}
					if (hole.isEmpty()) {
						continue;
					}
					// Default extrude keeps the top the same size as the base. Passing a
					// numeric scale collapses one axis, which turns each vent into a
					// wedge and leaves a slope across the raft.
					cutters.push(
						mapOwned(
							hole.extrude(depth + 0.2),
							(m) => m.rotate([-90, 0, 0]),
							(m) => m.translate([0, -0.1, 0])
						)
					);
				}
			}
		}

		if (cutters.length === 0) {
			return raft;
		}
		const vents = cutters.length === 1 ? cutters[0] : wasm.Manifold.union(cutters);
		if (cutters.length > 1) {
			deleteAll(...cutters);
		}
		try {
			const vented = wasm.Manifold.difference([raft, vents]);
			deleteAll(raft, vents);
			return vented;
		} catch (e) {
			deleteAll(raft, vents);
			throw e;
		}
	} finally {
		for (const section of owned) {
			section.delete();
		}
	}
}
