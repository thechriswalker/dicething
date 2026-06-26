// Parse a user-supplied SVG path (the raw `d` attribute) into a coin face shape.
//
// The coin is the only die that lets the user replace its face outline with an
// arbitrary shape. The shape is normalized into a unit square (max bounding
// dimension = 1, centered on the origin) so the existing `coin_diameter` control
// can scale it like the polygon outline. Holes are dropped (a coin face is
// solid) and only the largest outer contour is used.
//
// Legend fitting works against the real outline: we report whether it is convex
// so the builder can pick the fast convex-only containment maths for the common
// case and the general (concave-safe) maths only when needed.

import { Shape, Vector2 } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { centerShapes, scaleShapes } from './shapes';
import { removeRedundantPoints } from './engraving';

const _svg = new SVGLoader();

export type ParsedCoinPath = {
	// the normalized (unit-sized, centered) face outline.
	shape: Shape;
	// the outline as a simplified point loop (unit space). used to build the
	// face/rim rings so the walls meet the face edges exactly.
	outline: Array<Vector2>;
	// whether the outline is convex.
	convex: boolean;
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
	// Iteratively drop duplicate / near-collinear points (compounding removals,
	// re-reading live neighbours) rather than the single-pass `simplifyLoop`. A
	// single pass measures each point against its ORIGINAL neighbours, so once
	// some points are removed it can leave a residual triple that is near-collinear
	// among the SURVIVORS. The triangulator (libtess) then silently skips that
	// middle vertex in the face cap while the coin's rim walls still use it as a
	// segment corner -- a T-junction that makes the exported solid non-manifold.
	// The outline is unit-sized (max dim 1); 1e-4 here is ~0.0008-0.006 mm once the
	// coin is scaled to its 8-60 mm diameter, well below any visible feature.
	const outline = ensureClockwise(removeRedundantPoints(dedupeClose(shape.getPoints(96)), 1e-4));
	if (outline.length < 3) {
		return null;
	}
	const convex = isConvex(outline);
	return { shape, outline, convex };
}

// Validate a raw SVG path `d` for use as a coin face. Returns the structured
// result the parameter UI expects (invalid until it parses). Concave outlines
// are fully supported (the legend containment maths handles them), so they are
// not flagged.
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
	return { valid: true };
}
