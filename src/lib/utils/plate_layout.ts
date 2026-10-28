// Fit export meshes onto a rectangular build plate.
//
// Policy, in order:
//   1. If every object fits on one plate, use one plate. Types are kept in
//      separate blocks when that still fits; otherwise they share the plate.
//   2. Otherwise each type (dice, blanks, platforms, …) gets its own plate or
//      plates, so a mixed export does not interleave kinds across beds.
//   3. A type that itself does not fit on one plate fills each plate before
//      the next one is started, so the first plate holds as many as will pack.
//
// Placement is a 2D pack of each mesh's convex XZ footprint (´Y is up and is
// not moved, so every object stays on the bed). The bounding box is only a
// fallback: a point-down die leaves the corners of that box empty, and packing
// the boxes spills sets that nest by hand onto a second plate. Quarter-turn
// yaws are allowed; that keeps the same edge on the plate. Coordinates in a
// plan are centres relative to the plate centre. `applyPlateLayout` writes
// them onto the meshes.

import { Box3, Vector3, type BufferGeometry, type Mesh } from 'three';
import type { Manifold } from './manifold';
import { footprintOf, packPolygons, type Pt } from './plate_pack';

/** Gap between neighbouring objects, matching the grid layout (mm). */
export const PLATE_GAP_MM = 1;
/** Inset from the plate edge so nothing sits flush with the rim (mm). */
export const PLATE_MARGIN_MM = 1;

const EPS = 1e-3;

export type PlateMesh = {
	mesh: Mesh;
	group: string;
	manifold?: Manifold;
};

export type PlatePlacement = {
	/** Plate index, or -1 when the object does not fit on this plate. */
	plate: number;
	/** Centre relative to the plate centre (or, for overflow, the row centre). */
	x: number;
	z: number;
	/** Quarter-turns about Y. 0 keeps the mesh as built. */
	yaw: 0 | 1 | 2 | 3;
	/** True when `yaw` is odd, so the footprint axes are swapped. */
	rotated: boolean;
};

export type PlateLayoutPlan = {
	placements: Map<PlateMesh, PlatePlacement>;
	plateCount: number;
	overflow: number;
	width: number;
	depth: number;
};

export type PlateRect = { cx: number; cz: number; width: number; depth: number };

type PackItem = {
	index: number;
	w: number;
	h: number;
	hull: Array<Pt>;
};

type Item = PackItem & {
	group: string;
	mesh: PlateMesh;
};

type Rect = { x: number; y: number; w: number; h: number };

type RectPlacement = {
	index: number;
	x: number;
	y: number;
	w: number;
	h: number;
	yaw: 0 | 1 | 2 | 3;
	rotated: boolean;
};

type Orient = { w: number; h: number; rotated: boolean };

function orientations(w: number, h: number, allowRotate: boolean): Array<Orient> {
	const list: Array<Orient> = [{ w, h, rotated: false }];
	if (allowRotate && Math.abs(w - h) > EPS) {
		list.push({ w: h, h: w, rotated: true });
	}
	return list;
}

function fitsIn(w: number, h: number, binW: number, binH: number, allowRotate: boolean): boolean {
	return orientations(w, h, allowRotate).some((o) => o.w <= binW + EPS && o.h <= binH + EPS);
}

// Shelf packer. Items are already inflated by `gap`; the returned rectangles
// are the real (deflated) footprints, still in inflated-cell coordinates so
// neighbours stay `gap` apart. Returns null when something does not fit.
function shelfPack(
	items: Array<PackItem>,
	binW: number,
	binH: number,
	gap: number,
	allowRotate: boolean
): Array<RectPlacement> | null {
	const placed: Array<RectPlacement> = [];
	let x = 0;
	let y = 0;
	let shelfH = 0;
	let open = false;
	// The pack bin is `gap` larger than the real bin so the inflated cells
	// (footprint + gap) still fit when an object sits flush with the far edge.
	const packW = binW + gap;
	const packH = binH + gap;

	for (const item of items) {
		const candidates = orientations(item.w + gap, item.h + gap, allowRotate).filter(
			(o) => o.w <= packW + EPS && o.h <= packH + EPS
		);
		if (candidates.length === 0) {
			return null;
		}

		let chosen: Orient | null = null;
		if (open) {
			chosen = candidates.find((o) => o.w <= packW - x + EPS && o.h <= shelfH + EPS) ?? null;
		}
		if (!chosen) {
			const baseY = open ? y + shelfH : 0;
			chosen = candidates.find((o) => o.w <= packW + EPS && baseY + o.h <= packH + EPS) ?? null;
			if (!chosen) {
				return null;
			}
			y = baseY;
			x = 0;
			shelfH = chosen.h;
			open = true;
		}
		placed.push({
			index: item.index,
			x,
			y,
			w: chosen.w - gap,
			h: chosen.h - gap,
			yaw: chosen.rotated ? 1 : 0,
			rotated: chosen.rotated
		});
		x += chosen.w;
	}
	return placed;
}

function intersects(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS
	);
}

function contains(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x - EPS &&
		inner.y >= outer.y - EPS &&
		inner.x + inner.w <= outer.x + outer.w + EPS &&
		inner.y + inner.h <= outer.y + outer.h + EPS
	);
}

// Maximal-rectangles split (Jylänki): both horizontal and vertical leftovers
// are kept, then rectangles contained by another are dropped.
function splitFree(free: Array<Rect>, used: Rect): Array<Rect> {
	const next: Array<Rect> = [];
	for (const fr of free) {
		if (!intersects(fr, used)) {
			next.push(fr);
			continue;
		}
		if (used.x < fr.x + fr.w && used.x + used.w > fr.x) {
			if (used.y > fr.y && used.y < fr.y + fr.h) {
				next.push({ x: fr.x, y: fr.y, w: fr.w, h: used.y - fr.y });
			}
			if (used.y + used.h < fr.y + fr.h) {
				next.push({
					x: fr.x,
					y: used.y + used.h,
					w: fr.w,
					h: fr.y + fr.h - (used.y + used.h)
				});
			}
		}
		if (used.y < fr.y + fr.h && used.y + used.h > fr.y) {
			if (used.x > fr.x && used.x < fr.x + fr.w) {
				next.push({ x: fr.x, y: fr.y, w: used.x - fr.x, h: fr.h });
			}
			if (used.x + used.w < fr.x + fr.w) {
				next.push({
					x: used.x + used.w,
					y: fr.y,
					w: fr.x + fr.w - (used.x + used.w),
					h: fr.h
				});
			}
		}
	}
	const dead = new Set<number>();
	for (let i = 0; i < next.length; i++) {
		if (dead.has(i) || next[i].w <= EPS || next[i].h <= EPS) {
			dead.add(i);
			continue;
		}
		for (let j = 0; j < next.length; j++) {
			if (i === j || dead.has(j)) {
				continue;
			}
			if (contains(next[j], next[i])) {
				dead.add(i);
				break;
			}
		}
	}
	return next.filter((_, i) => !dead.has(i));
}

function maxRectsPack(
	items: Array<PackItem>,
	binW: number,
	binH: number,
	gap: number,
	allowRotate: boolean
): Array<RectPlacement> | null {
	const packW = binW + gap;
	const packH = binH + gap;
	let free: Array<Rect> = [{ x: 0, y: 0, w: packW, h: packH }];
	const placed: Array<RectPlacement> = [];

	for (const item of items) {
		const candidates = orientations(item.w + gap, item.h + gap, allowRotate);
		let best: {
			short: number;
			long: number;
			orient: Orient;
			x: number;
			y: number;
		} | null = null;
		for (const fr of free) {
			for (const orient of candidates) {
				if (orient.w > fr.w + EPS || orient.h > fr.h + EPS) {
					continue;
				}
				const leftoverW = fr.w - orient.w;
				const leftoverH = fr.h - orient.h;
				const short = Math.min(leftoverW, leftoverH);
				const long = Math.max(leftoverW, leftoverH);
				const better =
					!best ||
					short < best.short - EPS ||
					(Math.abs(short - best.short) <= EPS && long < best.long - EPS) ||
					(Math.abs(short - best.short) <= EPS &&
						Math.abs(long - best.long) <= EPS &&
						!orient.rotated &&
						best.orient.rotated);
				if (better) {
					best = { short, long, orient, x: fr.x, y: fr.y };
				}
			}
		}
		if (!best) {
			return null;
		}
		const used: Rect = { x: best.x, y: best.y, w: best.orient.w, h: best.orient.h };
		placed.push({
			index: item.index,
			x: used.x,
			y: used.y,
			w: used.w - gap,
			h: used.h - gap,
			yaw: best.orient.rotated ? 1 : 0,
			rotated: best.orient.rotated
		});
		free = splitFree(free, used);
	}
	return placed;
}

function packTight(
	items: Array<PackItem>,
	binW: number,
	binH: number,
	gap: number,
	allowRotate: boolean,
	thorough = false
): Array<RectPlacement> | null {
	if (items.length === 0) {
		return [];
	}
	const silhouette = packPolygons(items, binW, binH, gap, allowRotate, thorough);
	if (silhouette) {
		return silhouette.map((p) => ({
			index: p.index,
			x: p.x,
			y: p.y,
			w: p.w,
			h: p.h,
			yaw: p.yaw,
			rotated: p.yaw % 2 === 1
		}));
	}
	// Bounding boxes, when the silhouette search cannot place every piece.
	// Original order first, so a set that fits in rows stays in set order.
	const byMaxSide = [...items].sort(
		(a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h || a.index - b.index
	);
	const byArea = [...items].sort((a, b) => b.w * b.h - a.w * a.h || a.index - b.index);
	const orders = [items, byMaxSide, byArea];
	for (const order of orders) {
		const shelf = shelfPack(order, binW, binH, gap, allowRotate);
		if (shelf) {
			return shelf;
		}
	}
	for (const order of orders) {
		const packed = maxRectsPack(order, binW, binH, gap, allowRotate);
		if (packed) {
			return packed;
		}
	}
	return null;
}

function blockPack(
	groups: Array<Array<Item>>,
	binW: number,
	binH: number,
	gap: number,
	thorough: boolean
): Array<RectPlacement> | null {
	const blocks: Array<{
		rects: Array<RectPlacement>;
		w: number;
		h: number;
		minX: number;
		minY: number;
	}> = [];
	for (const group of groups) {
		const rects = packTight(group, binW, binH, gap, true, thorough);
		if (!rects) {
			return null;
		}
		if (rects.length === 0) {
			continue;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const r of rects) {
			minX = Math.min(minX, r.x);
			minY = Math.min(minY, r.y);
			maxX = Math.max(maxX, r.x + r.w);
			maxY = Math.max(maxY, r.y + r.h);
		}
		blocks.push({ rects, w: maxX - minX, h: maxY - minY, minX, minY });
	}
	if (blocks.length === 0) {
		return [];
	}
	if (blocks.length === 1) {
		return blocks[0].rects;
	}
	// Blocks are not rotated: their contents already have a fixed yaw.
	const blockItems: Array<PackItem> = blocks.map((b, i) => ({
		index: i,
		w: b.w,
		h: b.h,
		hull: [
			{ x: 0, y: 0 },
			{ x: b.w, y: 0 },
			{ x: b.w, y: b.h },
			{ x: 0, y: b.h }
		]
	}));
	const packed = packTight(blockItems, binW, binH, gap, false);
	if (!packed) {
		return null;
	}
	const out: Array<RectPlacement> = [];
	for (const bp of packed) {
		const block = blocks[bp.index];
		for (const r of block.rects) {
			out.push({
				...r,
				x: r.x - block.minX + bp.x,
				y: r.y - block.minY + bp.y
			});
		}
	}
	return out;
}

// Place `items` onto as few plates as the greedy fill needs. Each plate takes
// as many of the remaining objects as will still pack; leftovers start the
// next plate. Count wins over a fuller-but-smaller set, so a plate of many
// small dice is kept ahead of one that holds fewer large ones.
function packFill(
	items: Array<Item>,
	binW: number,
	binH: number,
	gap: number
): Array<Array<RectPlacement>> | null {
	if (items.length === 0) {
		return [];
	}
	let rest = [...items];
	const bins: Array<Array<RectPlacement>> = [];
	while (rest.length > 0) {
		const placed = fillPlate(rest, binW, binH, gap);
		if (!placed || placed.length === 0) {
			return null;
		}
		bins.push(placed);
		const used = new Set(placed.map((p) => p.index));
		rest = rest.filter((it) => !used.has(it.index));
	}
	return bins;
}

function fillPlate(
	items: Array<Item>,
	binW: number,
	binH: number,
	gap: number
): Array<RectPlacement> | null {
	const byArea = (dir: number) =>
		[...items].sort((a, b) => dir * (b.w * b.h - a.w * a.h) || a.index - b.index);
	// Set order, largest first, then smallest first. The last of those is what
	// finds a higher count when a big piece would block several smaller ones.
	const orders = [items, byArea(1), byArea(-1)];
	let best: Array<RectPlacement> | null = null;
	let bestArea = -1;
	for (const order of orders) {
		let chosen: Array<Item> = [];
		let packed: Array<RectPlacement> | null = null;
		for (const it of order) {
			const trial = packTight([...chosen, it], binW, binH, gap, true);
			if (trial) {
				chosen = [...chosen, it];
				packed = trial;
			}
		}
		if (!packed) {
			continue;
		}
		const area = packed.reduce((sum, r) => sum + r.w * r.h, 0);
		if (
			!best ||
			packed.length > best.length ||
			(packed.length === best.length && area > bestArea + EPS)
		) {
			best = packed;
			bestArea = area;
		}
		if (packed.length === items.length) {
			return packed;
		}
	}
	return best;
}

function centerOnPlate(
	rects: Array<RectPlacement>,
	plateW: number,
	plateD: number,
	margin: number
): Array<PlatePlacement> {
	if (rects.length === 0) {
		return [];
	}
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const r of rects) {
		const x = r.x + margin;
		const y = r.y + margin;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + r.w);
		maxY = Math.max(maxY, y + r.h);
	}
	const shiftX = (plateW - (maxX - minX)) / 2 - minX;
	const shiftY = (plateD - (maxY - minY)) / 2 - minY;
	return rects.map((r) => {
		const x = r.x + margin + shiftX;
		const y = r.y + margin + shiftY;
		return {
			plate: 0,
			x: x + r.w / 2 - plateW / 2,
			z: y + r.h / 2 - plateD / 2,
			yaw: r.yaw,
			rotated: r.rotated
		};
	});
}

function measure(named: Array<PlateMesh>): Array<Item> {
	return named.map((mesh, index) => {
		const foot = footprintOf(mesh.mesh.geometry);
		return {
			index,
			group: mesh.group,
			w: Math.max(foot.w, EPS),
			h: Math.max(foot.h, EPS),
			hull: foot.hull,
			mesh
		};
	});
}

function groupsOf(items: Array<Item>): Array<Array<Item>> {
	const order: Array<string> = [];
	const by = new Map<string, Array<Item>>();
	for (const it of items) {
		let bucket = by.get(it.group);
		if (!bucket) {
			bucket = [];
			by.set(it.group, bucket);
			order.push(it.group);
		}
		bucket.push(it);
	}
	return order.map((g) => by.get(g)!);
}

function overflowRow(items: Array<Item>, gap: number): Array<PlatePlacement> {
	if (items.length === 0) {
		return [];
	}
	const widths = items.map((it) => it.w);
	const total = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, items.length - 1);
	let cursor = -total / 2;
	return items.map((it, i) => {
		const x = cursor + it.w / 2;
		cursor += it.w + gap;
		return { plate: -1, x, z: 0, yaw: 0, rotated: false };
	});
}

export type PlateLayoutOptions = {
	gap?: number;
	margin?: number;
};

export function planPlateLayout(
	named: Array<PlateMesh>,
	plate: { x: number; y: number },
	options: PlateLayoutOptions = {}
): PlateLayoutPlan {
	const gap = options.gap ?? PLATE_GAP_MM;
	const margin = options.margin ?? PLATE_MARGIN_MM;
	const width = plate.x;
	const depth = plate.y;
	const placements = new Map<PlateMesh, PlatePlacement>();
	const usableW = width - 2 * margin;
	const usableH = depth - 2 * margin;

	const items = measure(named);
	if (items.length === 0 || usableW <= EPS || usableH <= EPS) {
		for (const it of items) {
			placements.set(it.mesh, { plate: -1, x: 0, z: 0, yaw: 0, rotated: false });
		}
		const row = overflowRow(items, gap);
		row.forEach((p, i) => placements.set(items[i].mesh, p));
		return { placements, plateCount: 0, overflow: items.length, width, depth };
	}

	const fitting: Array<Item> = [];
	const overflow: Array<Item> = [];
	for (const it of items) {
		if (fitsIn(it.w, it.h, usableW, usableH, true)) {
			fitting.push(it);
		} else {
			overflow.push(it);
		}
	}

	const emit = (plateIndex: number, rects: Array<RectPlacement>) => {
		const locals = centerOnPlate(rects, width, depth, margin);
		for (let i = 0; i < rects.length; i++) {
			const item = items[rects[i].index];
			placements.set(item.mesh, { ...locals[i], plate: plateIndex });
		}
	};

	const groups = groupsOf(fitting);
	let plateCount = 0;

	const onePlate =
		blockPack(groups, usableW, usableH, gap, true) ??
		packTight(fitting, usableW, usableH, gap, true, true);
	if (onePlate) {
		emit(0, onePlate);
		plateCount = fitting.length > 0 ? 1 : 0;
	} else {
		for (const group of groups) {
			const bins = packFill(group, usableW, usableH, gap);
			if (!bins) {
				overflow.push(...group);
				continue;
			}
			for (const bin of bins) {
				emit(plateCount, bin);
				plateCount++;
			}
		}
	}

	overflowRow(overflow, gap).forEach((p, i) => placements.set(overflow[i].mesh, p));

	return {
		placements,
		plateCount,
		overflow: overflow.length,
		width,
		depth
	};
}

// Split a category that occupies more than one plate into one group per
// plate (`dice_plate1`, `dice_plate2`). A category on a single plate keeps
// its own name. Objects that do not fit (plate < 0) become `dice_overflow`.
export function partitionForPlates<T extends { group: string }>(
	items: Array<T>,
	plateOf: (item: T) => number
): Array<{ key: string; items: Array<T> }> {
	const cats: Array<string> = [];
	const plates = new Map<string, Map<number, Array<T>>>();
	for (const item of items) {
		const p = plateOf(item);
		let byPlate = plates.get(item.group);
		if (!byPlate) {
			byPlate = new Map();
			plates.set(item.group, byPlate);
			cats.push(item.group);
		}
		const bucket = byPlate.get(p);
		if (bucket) {
			bucket.push(item);
		} else {
			byPlate.set(p, [item]);
		}
	}
	const out: Array<{ key: string; items: Array<T> }> = [];
	for (const cat of cats) {
		const byPlate = plates.get(cat)!;
		const real = [...byPlate.keys()].filter((p) => p >= 0).sort((a, b) => a - b);
		const spans = real.length > 1;
		for (const p of real) {
			const local = real.indexOf(p) + 1;
			out.push({
				key: spans ? `${cat}_plate${local}` : cat,
				items: byPlate.get(p)!
			});
		}
		const extra = byPlate.get(-1);
		if (extra && extra.length > 0) {
			out.push({ key: `${cat}_overflow`, items: extra });
		}
	}
	return out;
}

function replaceManifold(entry: PlateMesh, next: Manifold, prev: Manifold) {
	if (next !== prev) {
		prev.delete();
	}
	entry.manifold = next;
}

function placeMesh(entry: PlateMesh, worldX: number, worldZ: number, yaw: 0 | 1 | 2 | 3) {
	const geometry: BufferGeometry = entry.mesh.geometry;
	geometry.computeBoundingBox();
	const box = geometry.boundingBox ?? new Box3();
	const center = new Vector3();
	box.getCenter(center);
	const cx = center.x;
	const cz = center.z;

	if (yaw !== 0) {
		geometry.translate(-cx, 0, -cz);
		geometry.rotateY((yaw * Math.PI) / 2);
		geometry.translate(worldX, 0, worldZ);
		const man = entry.manifold;
		if (man) {
			// translate/rotate return a new solid; drop the intermediates.
			const centered = man.translate(-cx, 0, -cz);
			const spun = centered.rotate(0, yaw * 90, 0);
			const placed = spun.translate(worldX, 0, worldZ);
			if (centered !== man && centered !== placed) {
				centered.delete();
			}
			if (spun !== centered && spun !== placed) {
				spun.delete();
			}
			replaceManifold(entry, placed, man);
		}
	} else {
		const dx = worldX - cx;
		const dz = worldZ - cz;
		if (dx === 0 && dz === 0) {
			return;
		}
		geometry.translate(dx, 0, dz);
		const man = entry.manifold;
		if (man) {
			replaceManifold(entry, man.translate(dx, 0, dz), man);
		}
	}
}

function plateCenters(
	count: number,
	width: number,
	depth: number
): Array<{ cx: number; cz: number }> {
	if (count <= 0) {
		return [];
	}
	const gapX = Math.max(24, width * 0.08);
	const gapZ = Math.max(24, depth * 0.08);
	const cols = Math.ceil(Math.sqrt(count));
	const rows = Math.ceil(count / cols);
	const raw: Array<{ cx: number; cz: number }> = [];
	for (let i = 0; i < count; i++) {
		raw.push({
			cx: (i % cols) * (width + gapX),
			cz: Math.floor(i / cols) * (depth + gapZ)
		});
	}
	const ox = ((cols - 1) * (width + gapX)) / 2;
	const oz = ((rows - 1) * (depth + gapZ)) / 2;
	return raw.map((c) => ({ cx: c.cx - ox, cz: c.cz - oz }));
}

// `spread` lays plates out in a grid centred on the origin (the on-screen
// preview and the single-file export). `perPlate` puts every mesh at its
// plate-local centre, which is what a one-plate group file should contain.
export function applyPlateLayout(
	named: Array<PlateMesh>,
	plan: PlateLayoutPlan,
	mode: 'spread' | 'perPlate'
): Array<PlateRect> {
	if (mode === 'perPlate') {
		for (const entry of named) {
			const p = plan.placements.get(entry);
			if (!p) {
				continue;
			}
			placeMesh(entry, p.x, p.z, p.yaw);
		}
		return [{ cx: 0, cz: 0, width: plan.width, depth: plan.depth }];
	}

	const centers = plateCenters(Math.max(plan.plateCount, 1), plan.width, plan.depth);
	const rects: Array<PlateRect> = centers.map((c) => ({
		cx: c.cx,
		cz: c.cz,
		width: plan.width,
		depth: plan.depth
	}));
	const shown = plan.plateCount > 0 ? rects : rects.slice(0, 1);

	let overflowCount = 0;
	let rowHalf = 0;
	for (const entry of named) {
		const p = plan.placements.get(entry);
		if (!p || p.plate >= 0) {
			continue;
		}
		overflowCount++;
		entry.mesh.geometry.computeBoundingBox();
		const box = entry.mesh.geometry.boundingBox ?? new Box3();
		const size = new Vector3();
		box.getSize(size);
		rowHalf = Math.max(rowHalf, Math.abs(p.x) + size.x / 2);
	}
	const right = Math.max(...shown.map((r) => r.cx + r.width / 2));
	const sep = Math.max(24, plan.width * 0.08);
	const rowCenterX = overflowCount > 0 ? right + sep + rowHalf : 0;

	for (const entry of named) {
		const p = plan.placements.get(entry);
		if (!p) {
			continue;
		}
		if (p.plate < 0) {
			placeMesh(entry, rowCenterX + p.x, p.z, p.yaw);
			continue;
		}
		const c = centers[p.plate];
		placeMesh(entry, c.cx + p.x, c.cz + p.z, p.yaw);
	}
	return shown;
}
