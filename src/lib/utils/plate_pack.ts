// Pack convex footprints onto one rectangle.
//
// Dice rest on a vertex or an edge, so the bed footprint is a polygon and the
// corners of its bounding box are empty. Packing those boxes wastes enough of
// a narrow plate (a Mars 5 Ultra is only ~78 mm deep) to spill a set that
// nests by hand onto a second plate. This packer uses the convex hull of the
// mesh's XZ projection instead, and may yaw it by quarter-turns — the same
// edge stays on the bed.
//
// Placement is bottom-left: each piece sits at the lowest, then leftmost,
// spot that keeps `gap` between hulls. That choice depends on order — swapping
// two dice can be the difference between one plate and two — so when the
// outlines still have room on the plate, a near miss tries moving the piece
// that did not fit, then a bounded set of other orders. The forbidden region
// around a placed piece is the no-fit polygon (Minkowski sum), expanded by
// `gap` with rounded corners so a sharp tip does not grow a huge miter.

import type { BufferGeometry } from 'three';

export type Pt = { x: number; y: number };

export type PackPoly = {
	index: number;
	/** CCW hull relative to the footprint's bounding-box minimum. */
	hull: Array<Pt>;
	w: number;
	h: number;
};

export type PolyPlacement = {
	index: number;
	x: number;
	y: number;
	w: number;
	h: number;
	yaw: 0 | 1 | 2 | 3;
};

const EPS = 1e-4;

function signedArea(poly: Array<Pt>): number {
	let area = 0;
	for (let i = 0; i < poly.length; i++) {
		const p = poly[i];
		const q = poly[(i + 1) % poly.length];
		area += p.x * q.y - q.x * p.y;
	}
	return area / 2;
}

function ensureCCW(poly: Array<Pt>): Array<Pt> {
	return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

function convexHull(points: Array<Pt>): Array<Pt> {
	const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	if (pts.length <= 1) {
		return pts;
	}
	const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: Array<Pt> = [];
	for (const p of pts) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
			lower.pop();
		}
		lower.push(p);
	}
	const upper: Array<Pt> = [];
	for (let i = pts.length - 1; i >= 0; i--) {
		const p = pts[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
			upper.pop();
		}
		upper.push(p);
	}
	upper.pop();
	lower.pop();
	return lower.concat(upper);
}

function rectHull(w: number, h: number): Array<Pt> {
	return [
		{ x: 0, y: 0 },
		{ x: w, y: 0 },
		{ x: w, y: h },
		{ x: 0, y: h }
	];
}

/** Convex XZ footprint of a mesh, relative to its bounding-box minimum. */
export function footprintOf(geometry: BufferGeometry): { hull: Array<Pt>; w: number; h: number } {
	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	const w = Math.max((box?.max.x ?? 0) - (box?.min.x ?? 0), 1e-3);
	const h = Math.max((box?.max.z ?? 0) - (box?.min.z ?? 0), 1e-3);
	const pos = geometry.getAttribute('position');
	if (!pos || pos.count < 3 || !box) {
		return { hull: rectHull(w, h), w, h };
	}
	const minX = box.min.x;
	const minZ = box.min.z;
	const quant = 100;
	const seen = new Set<string>();
	const pts: Array<Pt> = [];
	for (let i = 0; i < pos.count; i++) {
		const x = Math.round((pos.getX(i) - minX) * quant) / quant;
		const y = Math.round((pos.getZ(i) - minZ) * quant) / quant;
		const key = `${x},${y}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		pts.push({ x, y });
	}
	const hull = ensureCCW(convexHull(pts));
	if (hull.length < 3 || Math.abs(signedArea(hull)) < 1e-4) {
		return { hull: rectHull(w, h), w, h };
	}
	return { hull, w, h };
}

function yawHull(hull: Array<Pt>, yaw: 0 | 1 | 2 | 3): { hull: Array<Pt>; w: number; h: number } {
	let maxX = 0;
	let maxY = 0;
	for (const p of hull) {
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	if (yaw === 0) {
		return { hull, w: maxX, h: maxY };
	}
	const ang = (yaw * Math.PI) / 2;
	const c = Math.cos(ang);
	const s = Math.sin(ang);
	const cx = maxX / 2;
	const cy = maxY / 2;
	const rotated = hull.map((p) => {
		const x = p.x - cx;
		const y = p.y - cy;
		// three.js rotateY: (x, z) -> (x cos + z sin, -x sin + z cos)
		return { x: cx + x * c + y * s, y: cy - x * s + y * c };
	});
	let minX = Infinity;
	let minY = Infinity;
	for (const p of rotated) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
	}
	const norm = rotated.map((p) => ({ x: p.x - minX, y: p.y - minY }));
	let w = 0;
	let h = 0;
	for (const p of norm) {
		w = Math.max(w, p.x);
		h = Math.max(h, p.y);
	}
	return { hull: ensureCCW(norm), w, h };
}

function minkowski(a: Array<Pt>, b: Array<Pt>): Array<Pt> {
	const pts: Array<Pt> = [];
	for (const p of a) {
		for (const q of b) {
			pts.push({ x: p.x + q.x, y: p.y + q.y });
		}
	}
	return ensureCCW(convexHull(pts));
}

// Parallel-curve offset. Corners are circular fillets, sampled so each chord
// stays just outside the true radius (a chord of the circle would cut the gap).
function offsetRound(poly: Array<Pt>, distance: number): Array<Pt> {
	if (distance <= EPS || poly.length < 3) {
		return poly;
	}
	const step = Math.PI / 18;
	const radius = distance / Math.cos(step / 2);
	const n = poly.length;
	const pts: Array<Pt> = [];
	const outward = (a: Pt, b: Pt) => {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		return { x: dy / len, y: -dx / len };
	};
	for (let i = 0; i < n; i++) {
		const prev = poly[(i - 1 + n) % n];
		const curr = poly[i];
		const next = poly[(i + 1) % n];
		const n0 = outward(prev, curr);
		const n1 = outward(curr, next);
		let a0 = Math.atan2(n0.y, n0.x);
		let a1 = Math.atan2(n1.y, n1.x);
		let sweep = a1 - a0;
		while (sweep <= -Math.PI) {
			sweep += Math.PI * 2;
		}
		while (sweep > Math.PI) {
			sweep -= Math.PI * 2;
		}
		if (sweep < 0) {
			sweep += Math.PI * 2;
		}
		const steps = Math.max(1, Math.ceil(sweep / step));
		for (let s = 0; s <= steps; s++) {
			const a = a0 + (sweep * s) / steps;
			pts.push({ x: curr.x + Math.cos(a) * radius, y: curr.y + Math.sin(a) * radius });
		}
	}
	return ensureCCW(convexHull(pts));
}

// Positions of `moving`'s bounding-box minimum where it would be closer than
// `gap` to `placed`. `moving` is local (minimum at the origin).
function noFit(placed: Array<Pt>, moving: Array<Pt>, gap: number): Array<Pt> {
	const reflected = moving.map((p) => ({ x: -p.x, y: -p.y }));
	const touch = minkowski(placed, reflected);
	return gap > EPS ? offsetRound(touch, gap) : touch;
}

function interiorXSpan(poly: Array<Pt>, y: number): [number, number] | null {
	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of poly) {
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	if (y <= minY + EPS || y >= maxY - EPS) {
		return null;
	}
	let left = Infinity;
	let right = -Infinity;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		const dy = b.y - a.y;
		if (Math.abs(dy) < 1e-12) {
			continue;
		}
		const t = (y - a.y) / dy;
		if (t < -1e-8 || t > 1 + 1e-8) {
			continue;
		}
		const x = a.x + t * (b.x - a.x);
		left = Math.min(left, x);
		right = Math.max(right, x);
	}
	if (!(right > left + EPS)) {
		return null;
	}
	return [left, right];
}

function firstFeasibleX(spans: Array<[number, number]>, minX: number, maxX: number): number | null {
	if (minX > maxX + EPS) {
		return null;
	}
	const blocks = spans
		.filter((span) => span[1] > span[0] + EPS)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let x = minX;
	for (const [l, r] of blocks) {
		if (x < l - EPS) {
			return x;
		}
		if (x > l + EPS && x < r) {
			x = r;
		}
	}
	return x <= maxX + EPS ? Math.min(x, maxX) : null;
}

function yEvents(nfps: Array<Array<Pt>>, maxY: number): Array<number> {
	const ys = [0, maxY];
	const step = 0.25;
	for (let y = 0; y <= maxY; y += step) {
		ys.push(Math.min(y, maxY));
	}
	for (const poly of nfps) {
		for (const p of poly) {
			if (p.y > -EPS && p.y < maxY + EPS) {
				ys.push(Math.min(maxY, Math.max(0, p.y)));
			}
		}
	}
	ys.sort((a, b) => a - b);
	const out: Array<number> = [];
	for (const y of ys) {
		if (out.length === 0 || y - out[out.length - 1] > EPS) {
			out.push(y);
		}
	}
	return out;
}

function bottomLeft(
	w: number,
	h: number,
	nfps: Array<Array<Pt>>,
	binW: number,
	binH: number
): { x: number; y: number } | null {
	const maxX = binW - w;
	const maxY = binH - h;
	if (maxX < -EPS || maxY < -EPS) {
		return null;
	}
	for (const y of yEvents(nfps, Math.max(0, maxY))) {
		const spans: Array<[number, number]> = [];
		for (const poly of nfps) {
			const span = interiorXSpan(poly, y);
			if (span) {
				spans.push(span);
			}
		}
		const x = firstFeasibleX(spans, 0, Math.max(0, maxX));
		if (x !== null) {
			return { x, y };
		}
	}
	return null;
}

type Yawed = { hull: Array<Pt>; w: number; h: number; yaw: 0 | 1 | 2 | 3 };

function orientationsOf(item: PackPoly, allowRotate: boolean): Array<Yawed> {
	const yaws: Array<0 | 1 | 2 | 3> = allowRotate ? [0, 1, 2, 3] : [0];
	return yaws.map((yaw) => ({ ...yawHull(item.hull, yaw), yaw }));
}

function placeSequence(
	order: Array<PackPoly>,
	binW: number,
	binH: number,
	gap: number,
	shapes: Map<number, Array<Yawed>>
): { placements: Array<PolyPlacement> | null; failedAt: number } {
	const placed: Array<{ world: Array<Pt>; placement: PolyPlacement }> = [];
	for (let i = 0; i < order.length; i++) {
		const item = order[i];
		const shapesForItem = shapes.get(item.index) ?? [];
		let best: { pos: { x: number; y: number }; shape: Yawed } | null = null;
		for (const shape of shapesForItem) {
			if (shape.w > binW + EPS || shape.h > binH + EPS) {
				continue;
			}
			const nfps = placed.map((p) => noFit(p.world, shape.hull, gap));
			const pos = bottomLeft(shape.w, shape.h, nfps, binW, binH);
			if (!pos) {
				continue;
			}
			const better =
				!best ||
				pos.y < best.pos.y - EPS ||
				(Math.abs(pos.y - best.pos.y) <= EPS && pos.x < best.pos.x - EPS) ||
				(Math.abs(pos.y - best.pos.y) <= EPS &&
					Math.abs(pos.x - best.pos.x) <= EPS &&
					shape.yaw < best.shape.yaw);
			if (better) {
				best = { pos, shape };
			}
		}
		if (!best) {
			return { placements: null, failedAt: i };
		}
		const world = best.shape.hull.map((p) => ({ x: p.x + best.pos.x, y: p.y + best.pos.y }));
		placed.push({
			world,
			placement: {
				index: item.index,
				x: best.pos.x,
				y: best.pos.y,
				w: best.shape.w,
				h: best.shape.h,
				yaw: best.shape.yaw
			}
		});
	}
	return { placements: placed.map((p) => p.placement), failedAt: order.length };
}

function ordersOf(items: Array<PackPoly>): Array<Array<PackPoly>> {
	const by = (score: (item: PackPoly) => number) =>
		[...items].sort((a, b) => score(b) - score(a) || a.index - b.index);
	const unique: Array<Array<PackPoly>> = [];
	const seen = new Set<string>();
	for (const order of [
		items,
		by((it) => Math.max(it.w, it.h)),
		by((it) => it.w * it.h),
		by((it) => it.w + it.h),
		by((it) => it.h),
		by((it) => it.w),
		// Small pieces first. The usual large-first sorts miss some nests.
		by((it) => -it.w * it.h)
	]) {
		const key = order.map((it) => it.index).join(',');
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(order);
	}
	return unique;
}

function orderKey(order: Array<PackPoly>): string {
	return order.map((item) => item.index).join(',');
}

function moved(order: Array<PackPoly>, from: number, to: number): Array<PackPoly> {
	const next = order.slice();
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}

function swapped(order: Array<PackPoly>, i: number, j: number): Array<PackPoly> {
	const next = order.slice();
	const tmp = next[i];
	next[i] = next[j];
	next[j] = tmp;
	return next;
}

// Stable across runs so the same set always picks the same plate.
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function orderSeed(items: Array<PackPoly>): number {
	let seed = 0x9e3779b9;
	for (const item of items) {
		seed = Math.imul(seed ^ item.index, 0x85ebca6b);
		seed ^= Math.round(item.w * 100);
		seed = Math.imul(seed, 0xc2b2ae35);
		seed ^= Math.round(item.h * 100);
	}
	return seed >>> 0;
}

function hullArea(item: PackPoly): number {
	return Math.abs(signedArea(item.hull));
}

// Bottom-left placement is greedy, so two orders of the same dice can disagree
// on whether they fit. When the outlines have room on the plate, move the
// piece that did not fit and try a bounded handful of other orders.
const SEARCH_BUDGET = 32;

function searchOrders(
	items: Array<PackPoly>,
	start: Array<PackPoly>,
	failedAt: number,
	seen: Set<string>,
	place: (order: Array<PackPoly>) => Array<PolyPlacement> | null
): Array<PolyPlacement> | null {
	const queue: Array<Array<PackPoly>> = [];
	const enqueue = (order: Array<PackPoly>) => {
		if (queue.length >= SEARCH_BUDGET) {
			return;
		}
		const key = orderKey(order);
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		queue.push(order);
	};

	if (failedAt < start.length) {
		for (let to = 0; to < start.length; to++) {
			if (to === failedAt) {
				continue;
			}
			enqueue(moved(start, failedAt, to));
		}
		for (let from = failedAt + 1; from < start.length; from++) {
			enqueue(moved(start, from, failedAt));
		}
	}
	for (let i = 0; i < start.length - 1; i++) {
		enqueue(swapped(start, i, i + 1));
	}

	const rng = mulberry32(orderSeed(items));
	const tail = Math.max(0, Math.min(failedAt - 1, start.length - 1));
	let spins = 0;
	while (queue.length < SEARCH_BUDGET && spins < SEARCH_BUDGET * 4) {
		spins++;
		const next = start.slice();
		const span = next.length - tail;
		if (span <= 1 || rng() < 0.5) {
			const i = Math.floor(rng() * next.length);
			const j = Math.floor(rng() * next.length);
			if (i === j) {
				continue;
			}
			const tmp = next[i];
			next[i] = next[j];
			next[j] = tmp;
		} else {
			for (let i = next.length - 1; i > tail; i--) {
				const j = tail + Math.floor(rng() * (i - tail + 1));
				const tmp = next[i];
				next[i] = next[j];
				next[j] = tmp;
			}
		}
		enqueue(next);
	}

	for (const order of queue) {
		const placed = place(order);
		if (placed) {
			return placed;
		}
	}
	return null;
}

export function packPolygons(
	items: Array<PackPoly>,
	binW: number,
	binH: number,
	gap: number,
	allowRotate: boolean,
	thorough = false
): Array<PolyPlacement> | null {
	if (items.length === 0) {
		return [];
	}
	const shapes = new Map<number, Array<Yawed>>();
	for (const item of items) {
		shapes.set(item.index, orientationsOf(item, allowRotate));
	}
	const seen = new Set<string>();
	let bestOrder = items;
	let bestPlaced = -1;
	const place = (order: Array<PackPoly>): Array<PolyPlacement> | null => {
		const result = placeSequence(order, binW, binH, gap, shapes);
		if (result.failedAt > bestPlaced) {
			bestPlaced = result.failedAt;
			bestOrder = order;
		}
		return result.placements;
	};

	for (const order of ordersOf(items)) {
		seen.add(orderKey(order));
		const placed = place(order);
		if (placed) {
			return placed;
		}
	}

	const binArea = binW * binH;
	const area = items.reduce((sum, item) => sum + hullArea(item), 0);
	if (!thorough || area > binArea + EPS || bestPlaced >= items.length) {
		return null;
	}
	return searchOrders(items, bestOrder, bestPlaced, seen, place);
}
