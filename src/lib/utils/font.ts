// Create a legend set from a font.
import { parse, type RenderOptions } from 'opentype.js';
import { Curve, LineCurve, QuadraticBezierCurve, Ray, Vector2, Vector3, type Shape } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { resolveShapeBoundaries } from './path_resolve';
import { centerShapes, scaleShapes } from './shapes';
import { shapeToJSON } from './to_json';

// these are in the same order as the "Legend" enum values
export const defaultStrings =
	'0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 6. 9. 30 40 50 60 70 80 90 00';

export const defaultRenderOptions: Record<string, RenderOptions> = {
	'6.': { letterSpacing: -0.1 },
	'9.': { letterSpacing: -0.1 }
};

// the teens and the
const specialCases: Record<string, string> = {
	'0': 'Zero',
	'00': 'Double Zero',
	'6.': 'Marked Six',
	'9.': 'Marked Nine',
	'11': 'Eleven',
	'12': 'Twelve',
	'13': 'Thirteen',
	'14': 'Fourteen',
	'15': 'Fifteen',
	'16': 'Sixteen',
	'17': 'Seventeen',
	'18': 'Eighteen',
	'19': 'Nineteen'
};
const ones: Array<string> = [
	'', // zero
	'One',
	'Two',
	'Three',
	'Four',
	'Five',
	'Six',
	'Seven',
	'Eight',
	'Nine'
];
const tens: Array<string> = [
	'', // <10
	'Ten',
	'Twenty',
	'Thirty',
	'Forty',
	'Fifty',
	'Sixty',
	'Seventy',
	'Eighty',
	'Ninety'
];
// only english and only up to 99.
export function numberStringToWords(s: string): string {
	// special cases first.
	if (s in specialCases) {
		return specialCases[s];
	}
	const n = parseInt(s, 10);
	if (!Number.isInteger(n)) {
		throw new Error(`Attempt to use non-integer symbol in builtin: ${s}`);
	}
	if (n < 0 || n > 99) {
		throw new Error(`Attempt to use out-of-range symbol in builtin: ${s}`);
	}
	const o = ones[n % 10];
	const t = tens[Math.floor(n / 10)];
	return [t, o].join(' ').trim();
}


export function addRenderOptions(
	strings: string,
	fontRenderOptions: Record<string, RenderOptions> = defaultRenderOptions
): Array<FontString> {
	return strings.split(' ').map((s) => {
		const o: FontString = { text: s };
		if (s in fontRenderOptions) {
			o.renderOptions = fontRenderOptions[s];
		}
		return o;
	});
}

export type FontString = {
	text: string;
	renderOptions?: RenderOptions;
};

const _svg = new SVGLoader();

const svgOpen = /(<svg[^>]*>)/m;
const svgClose = /(<\/svg>)/;

//the problem with "parse" is that is makes them inverted and flipped.
// so we need to inject a transform.
// scale is base on a "10x10" viewbox (like we use for fonts)
// our icons are 20x20 so we need to scale by 0.5
export function createShapesFromSVG(svg: string, scale: number = 1): Array<Shape> {
	// find the first closing tag.
	svg = svg.replace(svgOpen, (m) => {
		return m + `<g transform="rotate(180) scale(-1,1)">`;
	});
	svg = svg.replace(svgClose, (m) => {
		return `</g>` + m;
	});
	// now we can use the parseo
	const fromSVG = _svg.parse(svg).paths;
	const shapes = fromSVG.flatMap((p) => SVGLoader.createShapes(p));
	const cleaned = preprocessShapes(shapes);
	let c = centerShapes(...cleaned);
	if (scale != 1) {
		c = scaleShapes(scale, ...c);
	}
	return c.map(shapeToJSON);
}

export function createShapesFromFont(fontData: ArrayBufferLike, strings: Array<FontString>) {
	const font = parse(fontData);

	const legendShapes: Array<Array<Shape>> = strings.map((s) => {
		const opts = { kerning: true, ...(s.renderOptions || {}) };
		const paths = font.getPaths(s.text, 0, 0, 10, opts);
		// This is a massive inefficient hack, but it works...
		// We pregenerate these anyway...
		const svgText = `<svg width="30" height="20" viewBox="0 0 20 20">${paths
			.map((p) => p.toSVG(6))
			.join('\n')}</svg>`;
		return createShapesFromSVG(svgText);
	});

	return legendShapes;
}

function preprocessShapes(shapes: Array<Shape>): Array<Shape> {
	for (let s of shapes) {
		preprocessPaths(s.curves);
		s.holes.forEach((h) => {
			preprocessPaths(h.curves);
		});
	}
	// Resolve self-intersections and overlapping contours into a coherent
	// boundary (outline + holes), retaining the vector curve primitives.
	return resolveShapeBoundaries(shapes);
}

function curveIsLineCurve(c: Curve<Vector2>): c is LineCurve {
	return c.type === 'LineCurve';
}

function preprocessPaths(s: Array<Curve<Vector2>>) {
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		// first hueristic = 0-length LineCurve
		if (curveIsLineCurve(c)) {
			if (c.getLength() < 0.0001) {
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
	// Self-intersections and overlaps between contours are resolved separately,
	// at the shape level, by resolveShapeBoundaries (see ./path_resolve.ts),
	// which is invoked from preprocessShapes once every contour is simplified.
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
