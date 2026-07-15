import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOMParser } from 'xmldom';
import { ShapeUtils, type Shape } from 'three';
import { createShapesFromFont, addRenderOptions } from './font';
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
