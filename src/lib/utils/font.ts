// Create a legend set from a font.
import { parse } from 'opentype.js';
import { Curve, LineCurve, Vector2, type Shape } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { centerShapes } from './shapes';
import { shapeToJSON } from './to_json';

// these are in the same order as the "Legend" enum values
const defaultStrings =
	'0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 6. 9. 30 40 50 60 70 80 90 00'.split(' ');

const _svg = new SVGLoader();

export function createShapesFromFont(
	fontData: ArrayBufferLike,
	strings: Array<string> = defaultStrings
) {
	const font = parse(fontData);

	const legendShapes: Array<Array<Shape>> = strings.map((s) => {
		const paths = font.getPaths(s, 0, 0, 10, {
			kerning: true
		});
		// This is a massive inefficient hack, but it works...
		// We pregenerate these anyway...
		const svgText = `<svg width="30" height="20" viewBox="0 0 20 20"><g transform="rotate(180) scale(-1,1)">${paths
			.map((p) => p.toSVG(6))
			.join('\n')}</g></svg>`;
		const fromSVG = _svg.parse(svgText).paths;

		const shapes = fromSVG.flatMap((p) => SVGLoader.createShapes(p));
		preprocessShapes(shapes);
		const c = centerShapes(...shapes);
		return c.map(shapeToJSON);
	});

	return legendShapes;
}

function preprocessShapes(shapes: Array<Shape>) {
	for (let s of shapes) {
		preprocessPaths(s.curves);
		s.holes.forEach((h) => {
			preprocessPaths(h.curves);
		});
	}
}

function curveIsLineCurve(c: Curve<Vector2>): c is LineCurve {
	return c.type === 'LineCurve';
}

function preprocessPaths(s: Array<Curve<Vector2>>) {
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		// first hueristic = 0-length LineCurve
		if (curveIsLineCurve(c)) {
			if (c.v1.equals(c.v2)) {
				// remove.
				s.splice(i, 1);
				i--; // now pretend to go back one.
			}
		}
	}
}
