// Create a legend set from a font.
import { parse, type RenderOptions } from 'opentype.js';
import {
	Box2,
	Curve,
	LineCurve,
	Path,
	QuadraticBezierCurve,
	Ray,
	Shape,
	Vector2,
	Vector3,
	type BufferGeometry
} from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { resolveShapeBoundaries } from './path_resolve';
import { centerShapes, scaleShapes } from './shapes';
import { shapeFromJSON, shapeToJSON } from './to_json';

// these are in the same order as the "Legend" enum values
export const defaultStrings =
	'0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 6. 9. 30 40 50 60 70 80 90 00';

// the "100" preset: 0-99 with the 6/9 marked with a trailing dot.
export const zeroToNinetyNine: string = Array.from({ length: 100 })
	.map((_, i) => (i === 6 ? '6.' : i === 9 ? '9.' : '' + i))
	.join(' ');

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

// Thrown when an SVG contains only stroked (unfilled) paths, which we can't
// turn into engravable boundary shapes without offsetting the strokes.
export class StrokeOnlySVGError extends Error {
	constructor() {
		super('SVG contains only stroked paths (no fills)');
		this.name = 'StrokeOnlySVGError';
	}
}

// Elements SVGLoader can't turn into geometry; they're silently dropped on
// import, so we detect them up front and advise the user (e.g. convert text to
// a path in their vector editor).
const UNSUPPORTED_SVG_ELEMENTS = ['text', 'image', 'foreignObject'];

// Return the distinct unsupported element names present in an SVG string.
export function unsupportedSVGElements(svg: string): Array<string> {
	return UNSUPPORTED_SVG_ELEMENTS.filter((tag) =>
		new RegExp(`<${tag}[\\s/>]`, 'i').test(svg)
	);
}

// SVGLoader defaults an unspecified fill to black, so a path is "filled" unless
// it explicitly opts out with fill:none.
function isFilledPath(p: { userData?: { style?: { fill?: string } } }): boolean {
	const fill = p.userData?.style?.fill;
	return fill !== 'none' && fill !== undefined && fill !== 'transparent';
}
function isStrokedPath(p: { userData?: { style?: { stroke?: string } } }): boolean {
	const stroke = p.userData?.style?.stroke;
	return !!stroke && stroke !== 'none';
}

//the problem with "parse" is that is makes them inverted and flipped.
// so we need to inject a transform.
// scale is base on a "10x10" viewbox (like we use for fonts)
// our icons are 20x20 so we need to scale by 0.5
export function createShapesFromSVG(svg: string, scale: number = 1): Array<Shape> {
	return svgToShapes(svg, scale, false);
}

// As createShapesFromSVG, but throws StrokeOnlySVGError when the SVG only has
// stroked paths so callers can advise the user (we only support filled shapes).
export function createShapesFromSVGChecked(svg: string, scale: number = 1): Array<Shape> {
	return svgToShapes(svg, scale, true);
}

function svgToShapes(svg: string, scale: number, checkStroke: boolean): Array<Shape> {
	// find the first closing tag.
	svg = svg.replace(svgOpen, (m) => {
		return m + `<g transform="rotate(180) scale(-1,1)">`;
	});
	svg = svg.replace(svgClose, (m) => {
		return `</g>` + m;
	});
	// now we can use the parser
	const fromSVG = _svg.parse(svg).paths;
	// only filled paths can become boundary shapes; stroked-but-unfilled paths
	// would otherwise be closed and filled by createShapes (a "black square").
	const filled = fromSVG.filter(isFilledPath);
	// pure-stroke paths (stroke, but no fill) carry content we can't represent.
	// If any are present we'd silently drop them (and any background fill would
	// import as a solid square), so advise the user instead.
	const strokeOnly = fromSVG.filter((p) => isStrokedPath(p) && !isFilledPath(p));
	if (checkStroke && strokeOnly.length > 0) {
		throw new StrokeOnlySVGError();
	}
	const shapes = filled.flatMap((p) => SVGLoader.createShapes(p));
	if (shapes.length === 0) {
		return [];
	}
	const cleaned = preprocessShapes(shapes);
	let c = centerShapes(...cleaned);
	if (scale != 1) {
		c = scaleShapes(scale, ...c);
	}
	return c.map(shapeToJSON);
}

function injectSVGTransform(svg: string): string {
	svg = svg.replace(svgOpen, (m) => m + `<g transform="rotate(180) scale(-1,1)">`);
	svg = svg.replace(svgClose, (m) => `</g>` + m);
	return svg;
}

type ParsedPath = {
	userData?: { style?: unknown };
	subPaths: Array<{ getPoints(divisions?: number): Array<Vector2> }>;
};

// Recover the stroke boundary loops for every subpath of a path. Keeping a
// whole path's subpaths together is important: a compound path (e.g. an "O"
// outline, or an icon with cut-outs) relies on inner subpaths becoming holes,
// which only works when they're nested with their outer contour.
function pathStrokeLoops(path: ParsedPath, style: unknown): Array<Array<Vector2>> {
	const loops: Array<Array<Vector2>> = [];
	for (const sub of path.subPaths) {
		const pts = sub.getPoints();
		if (pts.length < 2) {
			continue;
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const geom = SVGLoader.pointsToStroke(pts, style as any);
		if (geom) {
			loops.push(...strokeGeometryToLoops(geom));
		}
	}
	return loops;
}

// "Trace outline" a whole path: let three tessellate each subpath's stroke into
// ribbon geometry (caps/joins/miters), recover the boundary loops, then nest
// them all by containment so closed strokes become hollow rings and compound
// cut-outs become holes.
function tracePath(path: ParsedPath, style: unknown): Array<Shape> {
	return loopsToShapes(pathStrokeLoops(path, style));
}

// Center a set of shapes about the origin and scale so the larger of their
// width/height fits `target` units (our standard glyph size). Imported SVG
// art comes in arbitrary viewBox units, so this is what makes it sit correctly
// in legend space (and in the fixed-viewBox previews).
function fitCentered(shapes: Array<Shape>, target: number): Array<Shape> {
	if (shapes.length === 0) {
		return shapes;
	}
	let c = centerShapes(...shapes);
	const box = new Box2();
	const p = new Vector2();
	for (const s of c) {
		for (const pt of s.getPoints()) {
			box.expandByPoint(pt);
		}
	}
	const size = box.getSize(p);
	const maxDim = Math.max(size.x, size.y);
	if (maxDim > 0 && isFinite(maxDim)) {
		c = scaleShapes(target / maxDim, ...c);
	}
	return c;
}

// Center + fit a set of already-serialized shapes (e.g. the combined result of
// a complex import) for storage in a legend slot.
export function finalizeImportedShapes(
	shapesJSON: Array<unknown>,
	target: number = 10
): Array<unknown> {
	if (shapesJSON.length === 0) {
		return [];
	}
	const shapes = shapesJSON.map((s) => shapeFromJSON(s));
	return fitCentered(shapes, target).map(shapeToJSON);
}

// "Trace outline": convert every stroked path into filled boundary shapes.
// Kept for convenience; the editor's complex import lets users pick per-piece.
export function createOutlineFromSVG(svg: string, target: number = 10): Array<Shape> {
	const paths = _svg.parse(injectSVGTransform(svg)).paths;
	const loops: Array<Array<Vector2>> = [];
	for (const p of paths) {
		if (!isStrokedPath(p)) {
			continue;
		}
		const path = p as unknown as ParsedPath;
		loops.push(...pathStrokeLoops(path, path.userData?.style));
	}
	return fitCentered(loopsToShapes(loops), target).map(shapeToJSON);
}

export type SvgPieceAction = 'trace' | 'fill' | 'ignore';

// One separable piece of an SVG: a whole path/shape element (its subpaths are
// kept together so compound paths' holes survive). Carries both the
// traced-stroke and filled interpretations as serialized shapes in a shared
// coordinate frame, so the UI can preview each and combine the chosen pieces
// before fitting.
export type SvgPiece = {
	label: string;
	stroked: boolean;
	filled: boolean;
	defaultAction: SvgPieceAction;
	trace: Array<unknown> | null;
	fill: Array<unknown> | null;
};

// Split an SVG into individually-selectable pieces (one per path/shape element)
// for the complex importer.
export function svgPieces(svg: string): Array<SvgPiece> {
	const paths = _svg.parse(injectSVGTransform(svg)).paths;
	const pieces: Array<SvgPiece> = [];
	let n = 0;
	for (const p of paths) {
		const path = p as unknown as ParsedPath;
		const stroked = isStrokedPath(p);
		const filled = isFilledPath(p);
		// Fill uses SVGLoader's own shape builder so compound paths keep holes.
		const filledShapes = SVGLoader.createShapes(p);
		const traced = tracePath(path, path.userData?.style);
		if (traced.length === 0 && filledShapes.length === 0) {
			continue;
		}
		n++;
		pieces.push({
			label: `#${n}`,
			stroked,
			filled,
			defaultAction: stroked ? 'trace' : filled ? 'fill' : 'ignore',
			trace: traced.length ? traced.map(shapeToJSON) : null,
			fill: filledShapes.length ? filledShapes.map(shapeToJSON) : null
		});
	}
	return pieces;
}

// Recover the boundary contour loops of a (non-indexed) triangle mesh: edges
// used by exactly one triangle are on the boundary; stitch them into loops.
function strokeGeometryToLoops(geom: BufferGeometry): Array<Array<Vector2>> {
	const pos = geom.getAttribute('position');
	if (!pos) {
		return [];
	}
	const Q = 1e4;
	const key = (x: number, y: number) => Math.round(x * Q) + ':' + Math.round(y * Q);
	const ek = (a: string, b: string) => (a < b ? a + '#' + b : b + '#' + a);
	const coord = new Map<string, Vector2>();
	const edgeCount = new Map<string, number>();

	const keyAt = (i: number) => {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const k = key(x, y);
		if (!coord.has(k)) {
			coord.set(k, new Vector2(x, y));
		}
		return k;
	};

	const triCount = Math.floor(pos.count / 3);
	for (let t = 0; t < triCount; t++) {
		const ks = [keyAt(3 * t), keyAt(3 * t + 1), keyAt(3 * t + 2)];
		for (let i = 0; i < 3; i++) {
			const a = ks[i];
			const b = ks[(i + 1) % 3];
			if (a === b) {
				continue;
			}
			const e = ek(a, b);
			edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
		}
	}

	const neighbors = new Map<string, string[]>();
	const boundary: Array<[string, string]> = [];
	const pushNeighbor = (a: string, b: string) => {
		const arr = neighbors.get(a);
		if (arr) {
			arr.push(b);
		} else {
			neighbors.set(a, [b]);
		}
	};
	for (const [e, c] of edgeCount) {
		if (c !== 1) {
			continue;
		}
		const [a, b] = e.split('#');
		boundary.push([a, b]);
		pushNeighbor(a, b);
		pushNeighbor(b, a);
	}

	const used = new Set<string>();
	const loops: Array<Array<Vector2>> = [];
	for (const [a0, b0] of boundary) {
		if (used.has(ek(a0, b0))) {
			continue;
		}
		used.add(ek(a0, b0));
		const loop = [a0, b0];
		let prev = a0;
		let cur = b0;
		while (true) {
			const nbrs = neighbors.get(cur) ?? [];
			let next: string | null = null;
			for (const n of nbrs) {
				if (n === prev) {
					continue;
				}
				if (used.has(ek(cur, n))) {
					continue;
				}
				next = n;
				break;
			}
			if (next === null) {
				break;
			}
			used.add(ek(cur, next));
			if (next === a0) {
				break; // closed the loop
			}
			loop.push(next);
			prev = cur;
			cur = next;
		}
		if (loop.length >= 3) {
			loops.push(loop.map((k) => coord.get(k)!.clone()));
		}
	}
	return loops;
}

function signedArea(pts: Array<Vector2>): number {
	let a = 0;
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i];
		const q = pts[(i + 1) % pts.length];
		a += p.x * q.y - q.x * p.y;
	}
	return a / 2;
}

function pointInPolygon(pt: Vector2, poly: Array<Vector2>): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		const intersects =
			a.y > pt.y !== b.y > pt.y &&
			pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
		if (intersects) {
			inside = !inside;
		}
	}
	return inside;
}

// Nest a set of boundary loops into outline + holes by containment (even-odd):
// a loop contained in an odd number of others is a hole of its nearest
// container; even depth (incl. 0) is solid. Outer contours are made CCW and
// holes CW so the downstream shape geometry carves correctly.
function loopsToShapes(loops: Array<Array<Vector2>>): Array<Shape> {
	const ls = loops
		.map((pts) => ({ pts, area: signedArea(pts), abs: Math.abs(signedArea(pts)) }))
		.filter((l) => l.abs > 1e-6);
	if (ls.length === 0) {
		return [];
	}

	const depth = ls.map((l, i) => {
		const sample = l.pts[0];
		let d = 0;
		for (let j = 0; j < ls.length; j++) {
			if (j === i || ls[j].abs <= l.abs) {
				continue;
			}
			if (pointInPolygon(sample, ls[j].pts)) {
				d++;
			}
		}
		return d;
	});

	const orient = (pts: Array<Vector2>, area: number, ccw: boolean) =>
		(area >= 0) === ccw ? pts : [...pts].reverse();

	const outers: Array<{ shape: Shape; pts: Array<Vector2>; abs: number }> = [];
	ls.forEach((l, i) => {
		if (depth[i] % 2 === 0) {
			const s = new Shape();
			s.setFromPoints(orient(l.pts, l.area, true));
			s.autoClose = true;
			outers.push({ shape: s, pts: l.pts, abs: l.abs });
		}
	});

	ls.forEach((l, i) => {
		if (depth[i] % 2 === 0) {
			return;
		}
		// nearest (smallest-area) even-depth container
		let best: (typeof outers)[number] | null = null;
		for (const o of outers) {
			if (o.abs <= l.abs) {
				continue;
			}
			if (!pointInPolygon(l.pts[0], o.pts)) {
				continue;
			}
			if (!best || o.abs < best.abs) {
				best = o;
			}
		}
		const hole = new Path();
		hole.setFromPoints(orient(l.pts, l.area, false));
		hole.autoClose = true;
		if (best) {
			best.shape.holes.push(hole);
		} else {
			const s = new Shape();
			s.setFromPoints(orient(l.pts, l.area, true));
			s.autoClose = true;
			outers.push({ shape: s, pts: l.pts, abs: l.abs });
		}
	});

	return outers.map((o) => o.shape);
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
