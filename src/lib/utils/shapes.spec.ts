import { describe, it, expect } from 'vitest';
import { Shape, Vector2 } from 'three';
import { isContained, findBestLegendScalingFactor, insetPolygon, scaleShapes } from './shapes';

function shapeFrom(points: Array<[number, number]>): Shape {
	return new Shape(points.map(([x, y]) => new Vector2(x, y)));
}

// An L-shaped (concave) polygon: the union of [0,2]x[0,1] and [0,1]x[0,2], with a
// single reflex corner at (1,1).
const lShape = shapeFrom([
	[0, 0],
	[2, 0],
	[2, 1],
	[1, 1],
	[1, 2],
	[0, 2]
]);

// A plus/cross centered on the origin (so legend fitting, which scales about the
// origin, has interior to grow into). Arm half-width 10, arm extent 30 - large
// enough that the fitter's fixed ~1mm margin is negligible and the geometry is
// what limits the fit.
const plusShape = shapeFrom([
	[-10, -30],
	[10, -30],
	[10, -10],
	[30, -10],
	[30, 10],
	[10, 10],
	[10, 30],
	[-10, 30],
	[-10, 10],
	[-30, 10],
	[-30, -10],
	[-10, -10]
]);

describe('general (concave) containment', () => {
	it('accepts a shape fully inside a concave lobe', () => {
		// a small square wholly inside the bottom arm of the L.
		const inner = shapeFrom([
			[0.8, 0.3],
			[1.2, 0.3],
			[1.2, 0.7],
			[0.8, 0.7]
		]);
		expect(isContained(lShape, [inner], 0, false)).toBe(true);
		// closest boundary is 0.3 away (the y=0 / y=1 edges of the arm).
		expect(isContained(lShape, [inner], 0.2, false)).toBe(true);
		expect(isContained(lShape, [inner], 0.4, false)).toBe(false);
	});

	it('rejects a shape sitting in the concavity (vertices outside)', () => {
		// the missing quadrant of the L: [1,2]x[1,2].
		const inner = shapeFrom([
			[1, 1],
			[2, 1],
			[2, 2],
			[1, 2]
		]);
		expect(isContained(lShape, [inner], 0, false)).toBe(false);
	});

	it('rejects a shape whose edge crosses the notch though all vertices are inside', () => {
		// a thin quad with corners in the two arms; its long edges cut across the
		// reflex notch near (1,1). point-in-polygon alone would pass it.
		const inner = shapeFrom([
			[1.4, 0.5],
			[1.5, 0.6],
			[0.6, 1.5],
			[0.5, 1.4]
		]);
		expect(isContained(lShape, [inner], 0, false)).toBe(false);
	});

	it('agrees with the convex path on a convex outer shape', () => {
		const square = shapeFrom([
			[-2, -2],
			[2, -2],
			[2, 2],
			[-2, 2]
		]);
		const inner = shapeFrom([
			[-0.5, -0.5],
			[0.5, -0.5],
			[0.5, 0.5],
			[-0.5, 0.5]
		]);
		expect(isContained(square, [inner], 1, true)).toBe(true);
		expect(isContained(square, [inner], 1, false)).toBe(true);
		expect(isContained(square, [inner], 1.6, true)).toBe(false);
		expect(isContained(square, [inner], 1.6, false)).toBe(false);
	});
});

describe('findBestLegendScalingFactor on a concave shape', () => {
	it('fits a legend using the full concave region and stays contained', () => {
		// a unit square legend centered on the origin; the plus's central 20x20
		// region lets it scale up to nearly fill it (side ~18), far larger than the
		// inscribed-circle approach (which would inscribe a square of side ~14).
		const legend = shapeFrom([
			[-0.5, -0.5],
			[0.5, -0.5],
			[0.5, 0.5],
			[-0.5, 0.5]
		]);
		const scale = findBestLegendScalingFactor(plusShape, [legend], 0, false);
		expect(scale).toBeGreaterThan(15);
		expect(scale).toBeLessThan(19);
		// the resolved scale must actually fit under the general test.
		expect(isContained(plusShape, scaleShapes(scale, legend), 0, false)).toBe(true);
		// and clearly-too-big overflows (corner pushed past the reflex corners).
		expect(isContained(plusShape, scaleShapes(scale * 1.5, legend), 0, false)).toBe(false);
	});
});

describe('insetPolygon', () => {
	it('insets a convex shape to a single smaller loop', () => {
		const square = shapeFrom([
			[-2, -2],
			[2, -2],
			[2, 2],
			[-2, 2]
		]);
		const loops = insetPolygon(square, 0.5, true);
		expect(loops).toHaveLength(1);
		for (const p of loops[0]) {
			expect(Math.abs(p.x)).toBeLessThanOrEqual(1.5 + 1e-6);
			expect(Math.abs(p.y)).toBeLessThanOrEqual(1.5 + 1e-6);
		}
	});

	it('insets a concave shape and keeps every point inside the original', () => {
		const loops = insetPolygon(plusShape, 0.25, false);
		expect(loops.length).toBeGreaterThan(0);
		// every inset vertex must lie within the plus (general containment of the
		// degenerate one-point "shapes" is overkill; just check the bounds of an arm).
		for (const loop of loops) {
			for (const p of loop) {
				const inHoriz = Math.abs(p.y) <= 10 + 1e-6 && Math.abs(p.x) <= 30 + 1e-6;
				const inVert = Math.abs(p.x) <= 10 + 1e-6 && Math.abs(p.y) <= 30 + 1e-6;
				expect(inHoriz || inVert).toBe(true);
			}
		}
	});
});
