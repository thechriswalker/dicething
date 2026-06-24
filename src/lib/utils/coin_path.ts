// Parse a user-supplied SVG path (the raw `d` attribute) into a coin face shape.
//
// The coin is the only die that lets the user replace its face outline with an
// arbitrary shape. The shape is normalized into a unit square (max bounding
// dimension = 1, centered on the origin) so the existing `coin_diameter` control
// can scale it like the polygon outline. Holes are dropped (a coin face is
// solid) and only the largest outer contour is used.
//
// Legend fitting assumes a convex outer shape, so for concave outlines we also
// compute a conservative convex `fitShape` (the largest inscribed circle as a
// polygon). Callers can surface a warning when the shape is concave since
// engraving may still reach into concavities.

import { Shape, Vector2 } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { centerShapes, scaleShapes } from './shapes';

const _svg = new SVGLoader();

export type ParsedCoinPath = {
	// the normalized (unit-sized, centered) face outline.
	shape: Shape;
	// the outline as a simplified point loop (unit space). used to build the
	// face/rim rings so the walls meet the face edges exactly.
	outline: Array<Vector2>;
	// whether the outline is convex.
	convex: boolean;
	// the convex fit region as a point loop (unit space). equals `outline` when
	// convex; otherwise the largest inscribed circle. used for legend fitting.
	fitOutline: Array<Vector2>;
};

// Wrap a raw path `d` in a minimal SVG. The y-flip mirrors what
// font.ts/svgToShapes does: SVGLoader works in y-down space, so we flip to land
// in three's y-up space and read as authored.
function wrapPath(d: string): string {
	const safe = d.replace(/"/g, '');
	return `<svg xmlns="http://www.w3.org/2000/svg"><g transform="scale(1,-1)"><path d="${safe}"/></g></svg>`;
}

// signed shoelace area of a closed point loop. positive => counter-clockwise
// (in y-up space), negative => clockwise.
function signedArea(points: Array<Vector2>): number {
	let area = 0;
	for (let i = 0, n = points.length; i < n; i++) {
		const a = points[i];
		const b = points[(i + 1) % n];
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}

// the other dice (and the legend-containment maths) assume face outlines are
// wound clockwise. reverse a loop if it isn't.
function ensureClockwise(points: Array<Vector2>): Array<Vector2> {
	return signedArea(points) > 0 ? points.slice().reverse() : points;
}

// drop a duplicated closing point if present, so loops are "open" lists.
function dedupeClose(points: Array<Vector2>): Array<Vector2> {
	if (points.length > 1) {
		const a = points[0];
		const b = points[points.length - 1];
		if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) {
			return points.slice(0, -1);
		}
	}
	return points;
}

// a shape keeping only its outer contour (curves), dropping any holes.
function outerOnly(shape: Shape): Shape {
	const s = new Shape();
	s.curves = shape.curves.slice();
	s.autoClose = shape.autoClose;
	return s;
}

// is the closed loop convex? all consecutive edge cross-products share a sign
// (zero / collinear points are tolerated).
function isConvex(points: Array<Vector2>): boolean {
	const n = points.length;
	if (n < 4) {
		// a triangle (or degenerate) is always convex.
		return true;
	}
	let sign = 0;
	for (let i = 0; i < n; i++) {
		const a = points[i];
		const b = points[(i + 1) % n];
		const c = points[(i + 2) % n];
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (Math.abs(cross) < 1e-9) {
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

function pointInPolygon(x: number, y: number, points: Array<Vector2>): boolean {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const vi = points[i];
		const vj = points[j];
		const intersect =
			vi.y > y !== vj.y > y && x < ((vj.x - vi.x) * (y - vi.y)) / (vj.y - vi.y) + vi.x;
		if (intersect) {
			inside = !inside;
		}
	}
	return inside;
}

function distanceToSegment(px: number, py: number, a: Vector2, b: Vector2): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	let t = lenSq === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));
	const cx = a.x + t * dx;
	const cy = a.y + t * dy;
	return Math.hypot(px - cx, py - cy);
}

function distanceToBoundary(x: number, y: number, points: Array<Vector2>): number {
	let min = Infinity;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const d = distanceToSegment(x, y, points[i], points[j]);
		if (d < min) {
			min = d;
		}
	}
	return min;
}

// drop points that are (near) collinear with their neighbours, so polygon paths
// (whose straight edges getPoints() over-samples) stay lean while curves keep
// enough points to read as smooth.
function simplifyLoop(points: Array<Vector2>, tol: number): Array<Vector2> {
	const n = points.length;
	if (n < 3) {
		return points;
	}
	const out: Array<Vector2> = [];
	for (let i = 0; i < n; i++) {
		const prev = points[(i - 1 + n) % n];
		const cur = points[i];
		const next = points[(i + 1) % n];
		const dx = next.x - prev.x;
		const dy = next.y - prev.y;
		const len = Math.hypot(dx, dy);
		// perpendicular distance from `cur` to the line prev->next.
		const dist =
			len < 1e-12
				? Math.hypot(cur.x - prev.x, cur.y - prev.y)
				: Math.abs((cur.x - prev.x) * dy - (cur.y - prev.y) * dx) / len;
		if (dist > tol) {
			out.push(cur);
		}
	}
	return out.length >= 3 ? out : points;
}

// largest inscribed circle ("pole of inaccessibility") via a simple grid search
// then a local refinement. returns the circle as a 32-gon point loop. used as a
// safe convex fit region for concave outlines.
function inscribedCircleLoop(points: Array<Vector2>): Array<Vector2> {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of points) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, r: 0 };
	const grid = 40;
	for (let ix = 0; ix <= grid; ix++) {
		for (let iy = 0; iy <= grid; iy++) {
			const x = minX + ((maxX - minX) * ix) / grid;
			const y = minY + ((maxY - minY) * iy) / grid;
			if (!pointInPolygon(x, y, points)) {
				continue;
			}
			const r = distanceToBoundary(x, y, points);
			if (r > best.r) {
				best = { x, y, r };
			}
		}
	}
	// local refinement around the best grid cell.
	let step = Math.max((maxX - minX) / grid, (maxY - minY) / grid);
	for (let iter = 0; iter < 30; iter++) {
		let improved = false;
		for (const [dx, dy] of [
			[step, 0],
			[-step, 0],
			[0, step],
			[0, -step]
		]) {
			const x = best.x + dx;
			const y = best.y + dy;
			if (!pointInPolygon(x, y, points)) {
				continue;
			}
			const r = distanceToBoundary(x, y, points);
			if (r > best.r) {
				best = { x, y, r };
				improved = true;
			}
		}
		if (!improved) {
			step /= 2;
		}
	}
	const segs = 32;
	const circle: Array<Vector2> = [];
	for (let k = 0; k < segs; k++) {
		const a = (k * 2 * Math.PI) / segs;
		circle.push(new Vector2(best.x + best.r * Math.cos(a), best.y + best.r * Math.sin(a)));
	}
	return circle;
}

// normalize a shape so its larger bounding dimension is 1, centered on origin.
function normalize(shape: Shape): Shape {
	const [centered] = centerShapes(shape);
	const pts = centered.getPoints(64);
	let maxDim = 0;
	for (const p of pts) {
		maxDim = Math.max(maxDim, Math.abs(p.x) * 2, Math.abs(p.y) * 2);
	}
	if (maxDim > 0 && isFinite(maxDim)) {
		const [scaled] = scaleShapes(1 / maxDim, centered);
		return scaled;
	}
	return centered;
}

// Parse a raw SVG path `d` into a normalized coin face shape. Returns null if
// nothing usable can be parsed (empty, malformed, or zero-area).
export function parseCoinPath(d: string): ParsedCoinPath | null {
	const trimmed = d.trim();
	if (!trimmed) {
		return null;
	}
	let candidates: Array<Shape> = [];
	try {
		const paths = _svg.parse(wrapPath(trimmed)).paths;
		for (const p of paths) {
			candidates.push(...SVGLoader.createShapes(p));
		}
	} catch {
		return null;
	}
	if (candidates.length === 0) {
		return null;
	}
	// pick the largest outer contour by area; drop holes.
	let chosen: Shape | null = null;
	let bestArea = 0;
	for (const s of candidates) {
		const outer = outerOnly(s);
		const area = Math.abs(signedArea(dedupeClose(outer.getPoints(64))));
		if (area > bestArea) {
			bestArea = area;
			chosen = outer;
		}
	}
	if (!chosen || bestArea < 1e-6) {
		return null;
	}
	const shape = normalize(chosen);
	const outline = ensureClockwise(simplifyLoop(dedupeClose(shape.getPoints(96)), 0.002));
	if (outline.length < 3) {
		return null;
	}
	const convex = isConvex(outline);
	const fitOutline = convex ? outline : ensureClockwise(inscribedCircleLoop(outline));
	return { shape, outline, convex, fitOutline };
}

// Validate a raw SVG path `d` for use as a coin face. Returns the structured
// result the parameter UI expects (invalid until it parses; a non-blocking
// warning when the resulting shape is concave).
export function validateCoinPath(d: string): {
	valid: boolean;
	error?: string;
	warning?: string;
} {
	if (!d.trim()) {
		return { valid: false, error: 'coin_path_empty' };
	}
	const parsed = parseCoinPath(d);
	if (!parsed) {
		return { valid: false, error: 'coin_path_invalid' };
	}
	if (!parsed.convex) {
		return { valid: true, warning: 'coin_path_concave' };
	}
	return { valid: true };
}
