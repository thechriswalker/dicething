// Create a legend set from a font.
import { parse } from 'opentype.js';
import { Curve, LineCurve, QuadraticBezierCurve, Ray, Vector2, Vector3, type Shape } from 'three';
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
		} else {
			let line = straightLineIfStraight(c);
			if (line) {
				s[i] = line;
			}
		}
	}
}

// for quadratic bezier curves, if they are actually straight, we can replace them we a LineCurve.
function straightLineIfStraight(c: Curve<Vector2>): LineCurve | null {
	if (c.type === 'QuadraticBezierCurve') {
		const q = c as QuadraticBezierCurve;
		// we will use the Ray in 3-space to model this as it provides distance to point functions.
		const s3 = new Vector3(q.v0.x, q.v0.y, 0);
		const d3 = s3
			.clone()
			.sub(new Vector3(q.v2.x, q.v2.y, 0))
			.normalize();
		const c3 = new Vector3(q.v1.x, q.v1.y, 0);
		const r = new Ray(s3, d3);
		if (r.distanceSqToPoint(c3) === 0) {
			// control point is on point.
			return new LineCurve(q.v0, q.v2);
		}
	}
	return null;
}
