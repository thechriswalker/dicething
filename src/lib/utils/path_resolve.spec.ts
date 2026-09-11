import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOMParser } from 'xmldom';
import { Shape, ShapeUtils } from 'three';
import { createShapesFromFont, addRenderOptions } from './font';
import { resolveShapeBoundaries } from './path_resolve';
import { shapeFromJSON } from './to_json';

// resolveShapeBoundaries runs at font-generation time. Josefin's "9" has a
// self-intersecting (figure-8) outline; an earlier tracer bug severed the body
// loop at the crossing and kept only a tiny fragment, so the glyph rendered as
// just its counter ("9" -> a dot, "19" -> "1", "90" -> "0"). These tests pin
// the resolved geometry through the real generation pipeline.
(globalThis as any).DOMParser = DOMParser;

const ttf = readFileSync(
	new URL('../fonts/builtins/josefin_medium/josefin_medium.ttf', import.meta.url)
).buffer;

function resolve(text: string): Shape[] {
	const out = createShapesFromFont(ttf, addRenderOptions(text));
	return out[0].map((s: any) => shapeFromJSON(s));
}

describe('resolveShapeBoundaries figure-8 glyphs (josefin)', () => {
	it('"9" keeps its body and counter hole', () => {
		const shapes = resolve('9');
		expect(shapes).toHaveLength(1);
		const area = Math.abs(ShapeUtils.area(shapes[0].getPoints(16)));
		// A full "9" body is ~20; the broken result was ~5.
		expect(area).toBeGreaterThan(15);
		expect(shapes[0].holes).toHaveLength(1);
	});

	it('"19" keeps both digits', () => {
		expect(resolve('19')).toHaveLength(2);
	});

	it('"90" keeps both digits', () => {
		expect(resolve('90')).toHaveLength(2);
	});

	it('"9." keeps the nine and the dot', () => {
		expect(resolve('9.')).toHaveLength(2);
	});

	it('"0" nests its counter as a hole (disjoint contours)', () => {
		const shapes = resolve('0');
		expect(shapes).toHaveLength(1);
		expect(shapes[0].holes).toHaveLength(1);
	});
});

describe('resolveShapeBoundaries overlapping path sections', () => {
	// Fonts sometimes emit one "path" as several overlapping filled subpaths
	// (multiple M…Z sections) that should union under the nonzero rule into a
	// single outline — optionally with a hole where the arrangement leaves a
	// zero-winding pocket. Without T-junction / collinear-overlap splits the
	// tracer kept only the pocket and dropped the outer ring.
	function poly(pts: Array<[number, number]>): Shape {
		const s = new Shape();
		s.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) {
			s.lineTo(pts[i][0], pts[i][1]);
		}
		s.autoClose = true;
		return s;
	}

	it('unions three overlapping subpaths into outer + hole', () => {
		// Coordinates scaled like legend font size (unitsPerEm ≈ 1000).
		const scale = 0.01;
		const shapes = [
			[
				[1050, 1870],
				[210, 2270],
				[3820, 6340],
				[4990, 6340],
				[1050, 1870]
			],
			[
				[210, 1300],
				[210, 2270],
				[6310, 2270],
				[6310, 1300],
				[210, 1300]
			],
			[
				[3910, 6340],
				[5030, 6340],
				[5030, -130],
				[3910, -130],
				[3910, 6340]
			]
		].map((pts) =>
			poly(pts.map(([x, y]) => [x * scale, y * scale] as [number, number]))
		);

		const out = resolveShapeBoundaries(shapes);
		expect(out).toHaveLength(1);
		expect(out[0].holes).toHaveLength(1);
		const outerArea = Math.abs(ShapeUtils.area(out[0].getPoints()));
		const holeArea = Math.abs(ShapeUtils.area(out[0].holes[0].getPoints()));
		// Broken result was only the ~357 hole triangle.
		expect(outerArea).toBeGreaterThan(1500);
		expect(holeArea).toBeGreaterThan(300);
		expect(holeArea).toBeLessThan(500);
	});
});
