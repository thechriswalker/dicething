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
import { m } from '$lib/paraglide/messages';
import { resolveShapeBoundaries } from './path_resolve';
import { centerShapes, scaleShapes } from './shapes';
import { unionBoundaryLoops } from './tessellate';
import { shapeFromJSON, shapeToJSON } from './to_json';

// The combined character set for a legend set, in slot order.
//
// The first 31 tokens line up with the "Legend" enum values for slots 0-30
// (0..20, marked 6/9, the tens 30-90, then 00). The maker logo is spliced in
// at slot 31 (MAKER_LOGO) by the generators, and the remaining numbers (every
// integer 21-99 that isn't already present as a "tens" glyph) follow from slot
// 32 onwards. See $lib/utils/legends for the value -> slot mapping.
const baseStrings =
	'0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 6. 9. 30 40 50 60 70 80 90 00';

// 21-99 excluding the multiples of ten already present in baseStrings.
const remainingNumbers: string = Array.from({ length: 99 - 21 + 1 }, (_, i) => i + 21)
	.filter((n) => n % 10 !== 0)
	.join(' ');

export const defaultStrings = baseStrings + ' ' + remainingNumbers;

export const defaultRenderOptions: Record<string, RenderOptions> = {
	'6.': { letterSpacing: -0.1 },
	'9.': { letterSpacing: -0.1 }
};

// Maps the non-numeric / special source tokens to their `legend_name` message
// key. Plain numeric tokens (e.g. "7", "42") use the number itself as the key.
const TOKEN_NAME_KEY: Record<string, string> = {
	'0': 'zero',
	'00': 'double_zero',
	'6.': 'marked_six',
	'9.': 'marked_nine'
};

// The `legend_name` message key for a source token, or undefined when the token
// isn't a known number/special (i.e. a custom character set glyph).
export function legendNameKeyForText(s: string): string | undefined {
	if (s in TOKEN_NAME_KEY) {
		return TOKEN_NAME_KEY[s];
	}
	const n = parseInt(s, 10);
	if (Number.isInteger(n) && String(n) === s && n >= 1 && n <= 99) {
		return s;
	}
	return undefined;
}

// Localized name for a legend slot derived from its source text. Numeric/special
// tokens resolve through the `legend_name` message (so they track the active
// locale); anything else (custom character sets) falls back to the raw text.
export function legendNameForText(s: string): string {
	const key = legendNameKeyForText(s);
	return key === undefined ? s : m.legend_name({ key, n: 0 });
}

// Back-compat alias: previously spelled out a number string in English. Now
// routes through the localized `legend_name` message.
export function numberStringToWords(s: string): string {
	return legendNameForText(s);
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
	return UNSUPPORTED_SVG_ELEMENTS.filter((tag) => new RegExp(`<${tag}[\\s/>]`, 'i').test(svg));
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

// Scale factor that fits an SVG icon's viewBox into `target` units (our standard
// glyph size). Icons are authored at arbitrary sizes, so we read the actual
// viewBox rather than assuming a fixed size. Falls back to 1 (no scaling) when
// no usable viewBox is present.
export function svgIconScale(svg: string, target: number = 10): number {
	const viewbox = svg.match(/viewBox="([^"]+)"/);
	if (!viewbox) {
		return 1;
	}
	const parts = viewbox[1]
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	const max = Math.max(parts[2], parts[3]);
	return max > 0 && isFinite(max) ? target / max : 1;
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

// "Trace outline" a path: stroke each subpath independently into ribbon
// geometry (caps/joins/miters), recover its boundary loops and nest them so a
// closed stroke becomes a hollow ring. Subpaths are traced separately and the
// bands simply overlap; nesting them together would fill internal regions of a
// multi-part shape (e.g. an icon's inner detail strokes).
function tracePath(path: ParsedPath, style: unknown): Array<Shape> {
	const shapes: Array<Shape> = [];
	for (const sub of path.subPaths) {
		const pts = sub.getPoints();
		if (pts.length < 2) {
			continue;
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const geom = SVGLoader.pointsToStroke(pts, style as any);
		if (geom) {
			shapes.push(...loopsToShapes(strokeGeometryToLoops(geom)));
		}
	}
	return shapes;
}

// Drop holes so each outer contour becomes a solid fill (a solid silhouette).
function solidOuter(shapes: Array<Shape>): Array<Shape> {
	return shapes.map((s) => {
		const c = new Shape();
		c.curves = s.curves.slice();
		c.autoClose = s.autoClose;
		return c;
	});
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
	const shapes: Array<Shape> = [];
	for (const p of paths) {
		if (!isStrokedPath(p)) {
			continue;
		}
		const path = p as unknown as ParsedPath;
		shapes.push(...tracePath(path, path.userData?.style));
	}
	return fitCentered(shapes, target).map(shapeToJSON);
}

export type SvgPieceAction = 'traceOutline' | 'usePath' | 'fillPath' | 'ignore';

// One separable piece of an SVG (one path/shape element). Carries each
// interpretation as serialized shapes in a shared coordinate frame, so the UI
// can preview them and combine the chosen pieces before fitting:
//   traceOutline - stroke the path's edges (closed strokes become hollow rings)
//   usePath      - the path exactly as authored, keeping its holes
//   fillPath     - the path filled solid (holes removed)
export type SvgPiece = {
	label: string;
	defaultAction: SvgPieceAction;
	traceOutline: Array<unknown> | null;
	usePath: Array<unknown> | null;
	fillPath: Array<unknown> | null;
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
		const traced = tracePath(path, path.userData?.style);
		// SVGLoader's own shape builder keeps compound paths' holes.
		const pathShapes = SVGLoader.createShapes(p);
		if (traced.length === 0 && pathShapes.length === 0) {
			continue;
		}
		n++;
		pieces.push({
			label: `#${n}`,
			defaultAction: stroked ? 'traceOutline' : filled ? 'usePath' : 'ignore',
			traceOutline: traced.length ? traced.map(shapeToJSON) : null,
			usePath: pathShapes.length ? pathShapes.map(shapeToJSON) : null,
			fillPath: pathShapes.length ? solidOuter(pathShapes).map(shapeToJSON) : null
		});
	}
	return pieces;
}

// Recover the boundary contour loops of a (non-indexed) triangle mesh. An edge
// used by exactly one triangle is on the boundary; we orient each such edge so
// the triangle (mesh interior) is on its LEFT, then walk the directed edges
// into loops. At self-touch junctions we pick the most-clockwise continuation,
// which correctly separates crossing loops (a naive undirected walk fragments
// self-intersecting strokes into spurious pieces).
function strokeGeometryToLoops(geom: BufferGeometry): Array<Array<Vector2>> {
	const pos = geom.getAttribute('position');
	if (!pos) {
		return [];
	}
	// Feed each (CCW-normalised) triangle to libtess and let it compute the union
	// boundary. A self-overlapping stroke mesh (any non-trivial outline) is a
	// triangle soup that meshes/walks can't cleanly trace; nonzero winding over
	// consistently-oriented triangles yields the correct outer + hole loops.
	const tris: Array<Array<Vector2>> = [];
	const triCount = Math.floor(pos.count / 3);
	for (let t = 0; t < triCount; t++) {
		const a = new Vector2(pos.getX(3 * t), pos.getY(3 * t));
		const b = new Vector2(pos.getX(3 * t + 1), pos.getY(3 * t + 1));
		const c = new Vector2(pos.getX(3 * t + 2), pos.getY(3 * t + 2));
		const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
		if (Math.abs(area) < 1e-12) {
			continue;
		}
		tris.push(area > 0 ? [a, b, c] : [a, c, b]);
	}
	return unionBoundaryLoops(tris);
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
			a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
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
		area >= 0 === ccw ? pts : [...pts].reverse();

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
