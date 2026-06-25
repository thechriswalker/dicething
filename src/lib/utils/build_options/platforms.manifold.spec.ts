// @vitest-environment jsdom
// (jsdom gives us the DOMParser that three's SVGLoader needs to parse the
// coin's custom SVG path; the default server env runs in plain node.)
import { describe, it, expect } from 'vitest';
import { Shape, Vector2 } from 'three';
import { buildPlatform } from './platforms';
import { parseCoinPath } from '../coin_path';
import { checkMesh, type MeshCheckReport } from '../mesh_check';

// the concave outline of the dicething logo (the coin's default custom path).
const coinGearPath = `M 206.779 143.103 Q 207.693 140.246 210.691 140.140 L 227.300 139.554 Q 230.298 139.449 230.298 136.449 L 230.298 103.551 Q 230.298 100.551 227.300 100.446 L 210.691 99.860 Q 207.693 99.754 206.779 96.897 L 204.064 88.416 Q 203.149 85.558 201.776 82.891 L 197.698 74.974 Q 196.324 72.307 198.370 70.113 L 209.700 57.954 Q 211.745 55.759 209.624 53.638 L 186.362 30.376 Q 184.241 28.255 182.046 30.300 L 169.887 41.630 Q 167.693 43.676 165.026 42.302 L 157.109 38.224 Q 154.442 36.851 151.584 35.936 L 143.103 33.221 Q 140.246 32.307 140.140 29.309 L 139.554 12.700 Q 139.449 9.702 136.449 9.702 L 103.551 9.702 Q 100.551 9.702 100.446 12.700 L 99.860 29.309 Q 99.754 32.307 96.897 33.221 L 88.416 35.936 Q 85.558 36.851 82.891 38.224 L 74.974 42.302 Q 72.307 43.676 70.113 41.630 L 57.954 30.300 Q 55.759 28.255 53.638 30.376 L 30.376 53.638 Q 28.255 55.759 30.300 57.954 L 41.630 70.113 Q 43.676 72.307 42.302 74.974 L 38.224 82.891 Q 36.851 85.558 35.936 88.416 L 33.221 96.897 Q 32.307 99.754 29.309 99.860 L 12.700 100.446 Q 9.702 100.551 9.702 103.551 L 9.702 136.449 Q 9.702 139.449 12.700 139.554 L 29.309 140.140 Q 32.307 140.246 33.221 143.103 L 35.936 151.584 Q 36.851 154.442 38.224 157.109 L 42.302 165.026 Q 43.676 167.693 41.630 169.887 L 30.300 182.046 Q 28.255 184.241 30.376 186.362 L 53.638 209.624 Q 55.759 211.745 57.954 209.700 L 70.113 198.370 Q 72.307 196.324 74.974 197.698 L 82.891 201.776 Q 85.558 203.149 88.416 204.064 L 96.897 206.779 Q 99.754 207.693 99.860 210.691 L 100.446 227.300 Q 100.551 230.298 103.551 230.298 L 136.449 230.298 Q 139.449 230.298 139.554 227.300 L 140.140 210.691 Q 140.246 207.693 143.103 206.779 L 151.584 204.064 Q 154.442 203.149 157.109 201.776 L 165.026 197.698 Q 167.693 196.324 169.887 198.370 L 182.046 209.700 Q 184.241 211.745 186.362 209.624 L 209.624 186.362 Q 211.745 184.241 209.700 182.046 L 198.370 169.887 Q 196.324 167.693 197.698 165.026 L 201.776 157.109 Q 203.149 154.442 204.064 151.584 L 206.779 143.103 Z`;

const defaultOpts = { height: 2, inset: 1.5, outset: 1.5 };

function report(shape: Shape, opts = defaultOpts): MeshCheckReport {
	const geo = buildPlatform(shape, opts);
	const pos = geo.toNonIndexed().getAttribute('position').array;
	return checkMesh(pos);
}

// build the coin's actual face shape: the normalized outline scaled to mm the
// same way coin.ts does (the inner ring is `outline * 2 * rInner`).
function coinFaceShape(): Shape {
	const parsed = parseCoinPath(coinGearPath);
	if (!parsed) {
		throw new Error('failed to parse coin gear path');
	}
	const rInner = 11.37; // ~ default 24mm diameter coin, minus the bevel inset.
	return new Shape(parsed.outline.map((p) => new Vector2(p.x * 2 * rInner, p.y * 2 * rInner)));
}

function regularPolygon(sides: number, radius: number): Shape {
	const pts: Array<Vector2> = [];
	for (let k = 0; k < sides; k++) {
		const a = (k * 2 * Math.PI) / sides;
		pts.push(new Vector2(radius * Math.cos(a), radius * Math.sin(a)));
	}
	return new Shape(pts);
}

// a star (sharp alternating convex/reflex vertices).
function starShape(points: number, outer: number, inner: number): Shape {
	const pts: Array<Vector2> = [];
	for (let k = 0; k < points * 2; k++) {
		const r = k % 2 === 0 ? outer : inner;
		const a = (k * Math.PI) / points;
		pts.push(new Vector2(r * Math.cos(a), r * Math.sin(a)));
	}
	return new Shape(pts);
}

// a gear (many shallow teeth) - a symmetric, collinear-prone outline like the
// coin's default logo.
function gearShape(teeth: number, outer: number, inner: number): Shape {
	const pts: Array<Vector2> = [];
	for (let k = 0; k < teeth * 4; k++) {
		const r = k % 4 < 2 ? outer : inner;
		const a = (k * Math.PI) / (teeth * 2);
		pts.push(new Vector2(r * Math.cos(a), r * Math.sin(a)));
	}
	return new Shape(pts);
}

// a plain concave "plus"/cross outline (reflex vertices at the inner corners).
function plusShape(arm: number, half: number): Shape {
	return new Shape([
		new Vector2(-half, -arm),
		new Vector2(half, -arm),
		new Vector2(half, -half),
		new Vector2(arm, -half),
		new Vector2(arm, half),
		new Vector2(half, half),
		new Vector2(half, arm),
		new Vector2(-half, arm),
		new Vector2(-half, half),
		new Vector2(-arm, half),
		new Vector2(-arm, -half),
		new Vector2(-half, -half)
	]);
}

describe('buildPlatform produces a manifold, watertight solid', () => {
	it('convex polygon (pentagon)', () => {
		const r = report(regularPolygon(5, 10));
		expect(r.nonManifoldEdgeCount).toBe(0);
		expect(r.boundaryEdgeCount).toBe(0);
		expect(r.degenerateTriangleCount).toBe(0);
		expect(r.duplicateTriangleCount).toBe(0);
		expect(r.isPrintable).toBe(true);
	});

	it('concave polygon (plus / cross)', () => {
		const r = report(plusShape(10, 4));
		expect(r.nonManifoldEdgeCount).toBe(0);
		expect(r.boundaryEdgeCount).toBe(0);
		expect(r.degenerateTriangleCount).toBe(0);
		expect(r.duplicateTriangleCount).toBe(0);
		expect(r.isPrintable).toBe(true);
	});

	it('concave polygon (5-point star)', () => {
		const r = report(starShape(5, 12, 5));
		expect(r.nonManifoldEdgeCount).toBe(0);
		expect(r.boundaryEdgeCount).toBe(0);
		expect(r.degenerateTriangleCount).toBe(0);
		expect(r.duplicateTriangleCount).toBe(0);
		expect(r.isPrintable).toBe(true);
	});

	it('concave polygon (gear, like the coin logo)', () => {
		const r = report(gearShape(8, 12, 9));
		expect(r.nonManifoldEdgeCount).toBe(0);
		expect(r.boundaryEdgeCount).toBe(0);
		expect(r.degenerateTriangleCount).toBe(0);
		expect(r.duplicateTriangleCount).toBe(0);
		expect(r.isPrintable).toBe(true);
	});

	it('coin d2 concave custom path (dicething logo)', () => {
		const r = report(coinFaceShape());
		expect(r.nonManifoldEdgeCount).toBe(0);
		expect(r.boundaryEdgeCount).toBe(0);
		expect(r.degenerateTriangleCount).toBe(0);
		expect(r.duplicateTriangleCount).toBe(0);
		expect(r.isPrintable).toBe(true);
	});
});
