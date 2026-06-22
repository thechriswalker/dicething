// Vector-preserving self-intersection / overlap cleanup for shape outlines.
//
// Font and SVG glyphs frequently contain contours that cross themselves
// (figure-8 strokes) or separate contours that overlap, where the visible
// fill is decided by a winding rule. This module resolves the coherent fill
// boundary of a whole set of shapes (outlines + holes together) into clean,
// non-overlapping `Shape`s while KEEPING the original curve primitives
// (Line / Quadratic / Cubic) rather than flattening everything to polygons.
//
// Pipeline (see the plan):
//   collect contours -> flatten with parameter tracking -> find all
//   intersections -> split curves into fragments -> classify each fragment by
//   the winding number a hair to its left vs. right -> keep only fragments
//   that separate inside from outside -> reconnect survivors into loops ->
//   group loops into outline + holes -> rebuild Shapes.
//
// The line/line intersection and point-in-polygon winding math follow the
// approach in vendor/unmess.ts; we do NOT reuse its tracer because that emits
// polygons and would discard curve information.

import {
	CubicBezierCurve,
	Curve,
	LineCurve,
	Path,
	QuadraticBezierCurve,
	Shape,
	ShapeUtils,
	Vector2
} from 'three';

export type WindingRule = 'nonzero' | 'evenodd';

export type ResolveOptions = {
	// Max deviation when flattening curves to find intersections / compute
	// winding. Smaller = more accurate, slower. Coordinates are roughly 0..20.
	flattenTolerance?: number;
	// How far to step to either side of a fragment when testing inside/outside.
	// Must comfortably exceed flattenTolerance but stay below the smallest
	// feature (e.g. stroke width).
	sideOffset?: number;
	// Distance under which two points are treated as the same node.
	epsilon?: number;
	// Fill rule used to decide what counts as "inside".
	windingRule?: WindingRule;
};

const DEFAULTS = {
	flattenTolerance: 0.01,
	sideOffset: 0.03,
	epsilon: 1e-4,
	windingRule: 'nonzero' as WindingRule
};

type Sample = { pt: Vector2; t: number };

type Edge = {
	ci: number; // contour index
	cj: number; // curve index within the contour
	t0: number; // curve parameter at edge start
	t1: number; // curve parameter at edge end
	a: Vector2;
	b: Vector2;
};

type Fragment = {
	curve: Curve<Vector2>;
	startNode: number;
	endNode: number;
};

type Loop = {
	fragments: Fragment[];
	points: Vector2[];
	area: number; // signed (shoelace)
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function resolveShapeBoundaries(shapes: Array<Shape>, opts: ResolveOptions = {}): Array<Shape> {
	if (shapes.length === 0) {
		return shapes;
	}
	const o = { ...DEFAULTS, ...opts };

	// Gather every contour (outline + holes) as an ordered closed loop of curves.
	// three's Path/Shape often relies on `autoClose` and omits the final
	// closing edge, so we add it explicitly here (without mutating the input).
	const contours: Array<Array<Curve<Vector2>>> = [];
	for (const s of shapes) {
		if (s.curves.length) {
			contours.push(closedCurves(s.curves, o.epsilon));
		}
		for (const h of s.holes) {
			if (h.curves.length) {
				contours.push(closedCurves(h.curves, o.epsilon));
			}
		}
	}
	if (contours.length === 0) {
		return shapes;
	}

	// Flatten each contour, keeping the curve index + parameter for every edge
	// (used to locate intersections) and a plain polyline (used for winding).
	const contourEdges: Edge[][] = [];
	const polylines: Vector2[][] = [];
	for (let ci = 0; ci < contours.length; ci++) {
		const { edges, polyline } = flattenContour(contours[ci], ci, o.flattenTolerance);
		contourEdges.push(edges);
		polylines.push(polyline);
	}

	// Find all intersections and record split parameters per curve.
	const splits = new Map<string, number[]>();
	const recordSplit = (ci: number, cj: number, t: number) => {
		const key = ci + '|' + cj;
		let arr = splits.get(key);
		if (!arr) {
			arr = [];
			splits.set(key, arr);
		}
		arr.push(t);
	};

	let anyIntersection = false;
	for (let ai = 0; ai < contourEdges.length; ai++) {
		const edgesA = contourEdges[ai];
		for (let bi = ai; bi < contourEdges.length; bi++) {
			const edgesB = contourEdges[bi];
			const sameContour = ai === bi;
			const nA = edgesA.length;
			for (let i = 0; i < nA; i++) {
				const ea = edgesA[i];
				const jStart = sameContour ? i + 1 : 0;
				for (let j = jStart; j < edgesB.length; j++) {
					if (sameContour && isAdjacent(i, j, nA)) {
						continue;
					}
					const eb = edgesB[j];
					if (aabbDisjoint(ea, eb)) {
						continue;
					}
					const hit = segmentIntersect(ea.a, ea.b, eb.a, eb.b);
					if (!hit) {
						continue;
					}
					// Map the segment-fraction back to a curve parameter, then
					// refine on the real curves so the point is exact.
					const tA = ea.t0 + hit.t * (ea.t1 - ea.t0);
					const tB = eb.t0 + hit.u * (eb.t1 - eb.t0);
					const refined = refineIntersection(
						contours[ea.ci][ea.cj],
						tA,
						contours[eb.ci][eb.cj],
						tB
					);
					if (!refined) {
						continue;
					}
					recordSplit(ea.ci, ea.cj, refined.tA);
					recordSplit(eb.ci, eb.cj, refined.tB);
					anyIntersection = true;
				}
			}
		}
	}

	// Nothing overlaps: the input is already clean, keep curves verbatim.
	if (!anyIntersection) {
		return shapes;
	}

	// Split every curve at its intersection parameters into fragments and
	// register their endpoints as shared nodes.
	const nodes = new NodeRegistry(o.epsilon);
	const fragments: Fragment[] = [];
	for (let ci = 0; ci < contours.length; ci++) {
		const curves = contours[ci];
		for (let cj = 0; cj < curves.length; cj++) {
			const curve = curves[cj];
			const params = cleanParams(splits.get(ci + '|' + cj));
			let prev = 0;
			const breakpoints = [...params, 1];
			for (const t of breakpoints) {
				if (t - prev < 1e-7) {
					prev = t;
					continue;
				}
				const piece = splitCurve(curve, prev, t);
				prev = t;
				const startNode = nodes.id(piece.getPoint(0));
				const endNode = nodes.id(piece.getPoint(1));
				if (startNode === endNode) {
					continue; // degenerate
				}
				// Snap endpoints onto the shared node so loops stay watertight.
				setCurveStart(piece, nodes.point(startNode));
				setCurveEnd(piece, nodes.point(endNode));
				fragments.push({ curve: piece, startNode, endNode });
			}
		}
	}

	// Classify each fragment: keep only those with inside on exactly one side,
	// and orient survivors so the inside lies on their left.
	const insideTest = makeInsideTest(polylines, o.windingRule);
	const kept: Fragment[] = [];
	for (const frag of fragments) {
		const mid = frag.curve.getPoint(0.5);
		const tan = tangentAt(frag.curve, 0.5);
		const len = Math.hypot(tan.x, tan.y) || 1;
		// Left normal of the travel direction (rotate tangent +90deg).
		const nx = -tan.y / len;
		const ny = tan.x / len;
		const left = new Vector2(mid.x + nx * o.sideOffset, mid.y + ny * o.sideOffset);
		const right = new Vector2(mid.x - nx * o.sideOffset, mid.y - ny * o.sideOffset);
		const insideLeft = insideTest(left);
		const insideRight = insideTest(right);
		if (insideLeft === insideRight) {
			continue; // both inside or both outside -> not a boundary
		}
		if (insideLeft) {
			kept.push(frag);
		} else {
			// Inside is on the right; reverse so it is on the left.
			kept.push({
				curve: reverseCurve(frag.curve),
				startNode: frag.endNode,
				endNode: frag.startNode
			});
		}
	}

	// A self-intersection splits the outline at the two curve vertices flanking
	// the crossing, and the classifier discards the tiny interior segment
	// between them. That leaves the surviving arc dangling at two endpoints that
	// are the same pinch point geometrically but carry different node ids, so
	// the loop can never close. Weld such dangling endpoints back together.
	weldDanglingEndpoints(kept, nodes, o.sideOffset * 3);

	// Reconnect kept fragments into closed loops.
	const rawLoops = traceLoops(kept);

	// Turn loops into Shapes (outline + holes).
	return buildShapes(rawLoops, shapes);
}

// ---------------------------------------------------------------------------
// Flattening (with parameter tracking)
// ---------------------------------------------------------------------------

// Return the curves of a contour guaranteed to form a closed loop, appending a
// straight closing segment if the last point does not meet the first. The
// returned array is always a fresh array (input is never mutated).
function closedCurves(curves: Array<Curve<Vector2>>, epsilon: number): Array<Curve<Vector2>> {
	const start = curves[0].getPoint(0);
	const end = curves[curves.length - 1].getPoint(1);
	if (near(start, end, Math.max(epsilon, 1e-6))) {
		return curves.slice();
	}
	return [...curves, new LineCurve(end.clone(), start.clone())];
}

function flattenContour(
	curves: Array<Curve<Vector2>>,
	ci: number,
	tol: number
): { edges: Edge[]; polyline: Vector2[] } {
	const edges: Edge[] = [];
	const polyline: Vector2[] = [];
	for (let cj = 0; cj < curves.length; cj++) {
		const samples = flattenCurve(curves[cj], tol);
		for (let k = 0; k < samples.length - 1; k++) {
			edges.push({
				ci,
				cj,
				t0: samples[k].t,
				t1: samples[k + 1].t,
				a: samples[k].pt,
				b: samples[k + 1].pt
			});
		}
		for (const s of samples) {
			const last = polyline[polyline.length - 1];
			if (last && near(last, s.pt, 1e-7)) {
				continue;
			}
			polyline.push(s.pt);
		}
	}
	if (polyline.length > 1 && near(polyline[0], polyline[polyline.length - 1], 1e-7)) {
		polyline.pop();
	}
	return { edges, polyline };
}

// Adaptive subdivision based on chord deviation. Samples are returned in
// ascending parameter order, each tagged with its curve parameter t.
function flattenCurve(curve: Curve<Vector2>, tol: number): Sample[] {
	if (curve instanceof LineCurve) {
		return [
			{ pt: curve.v1.clone(), t: 0 },
			{ pt: curve.v2.clone(), t: 1 }
		];
	}
	const tol2 = tol * tol;
	const samples: Sample[] = [];
	const p0 = curve.getPoint(0);
	const p1 = curve.getPoint(1);
	samples.push({ pt: p0, t: 0 });
	subdivide(0, 1, p0, p1);
	samples.push({ pt: p1, t: 1 });
	return samples;

	function subdivide(t0: number, t1: number, a: Vector2, b: Vector2, depth = 0) {
		if (depth > 16) {
			return;
		}
		const tm = (t0 + t1) * 0.5;
		const m = curve.getPoint(tm);
		if (distToSegmentSq(m, a, b) > tol2) {
			subdivide(t0, tm, a, m, depth + 1);
			samples.push({ pt: m, t: tm });
			subdivide(tm, t1, m, b, depth + 1);
		}
	}
}

// ---------------------------------------------------------------------------
// Intersection
// ---------------------------------------------------------------------------

function isAdjacent(i: number, j: number, n: number): boolean {
	return j === i + 1 || (i === 0 && j === n - 1);
}

function aabbDisjoint(ea: Edge, eb: Edge): boolean {
	if (Math.max(ea.a.x, ea.b.x) < Math.min(eb.a.x, eb.b.x)) return true;
	if (Math.min(ea.a.x, ea.b.x) > Math.max(eb.a.x, eb.b.x)) return true;
	if (Math.max(ea.a.y, ea.b.y) < Math.min(eb.a.y, eb.b.y)) return true;
	if (Math.min(ea.a.y, ea.b.y) > Math.max(eb.a.y, eb.b.y)) return true;
	return false;
}

// Returns the interior intersection fractions (t along AB, u along CD) or null.
function segmentIntersect(
	a: Vector2,
	b: Vector2,
	c: Vector2,
	d: Vector2
): { t: number; u: number } | null {
	const rx = b.x - a.x;
	const ry = b.y - a.y;
	const sx = d.x - c.x;
	const sy = d.y - c.y;
	const denom = rx * sy - ry * sx;
	if (denom === 0) {
		return null; // parallel / collinear
	}
	const qpx = c.x - a.x;
	const qpy = c.y - a.y;
	const t = (qpx * sy - qpy * sx) / denom;
	const u = (qpx * ry - qpy * rx) / denom;
	const e = 1e-9;
	if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) {
		return null;
	}
	return { t, u };
}

// Newton refinement so that cA(tA) == cB(tB) precisely. Returns null if the
// solution leaves the interior of either curve (i.e. it was just a shared
// endpoint, not a real crossing).
function refineIntersection(
	cA: Curve<Vector2>,
	tA0: number,
	cB: Curve<Vector2>,
	tB0: number
): { tA: number; tB: number } | null {
	let tA = tA0;
	let tB = tB0;
	for (let iter = 0; iter < 12; iter++) {
		const P = cA.getPoint(tA);
		const Q = cB.getPoint(tB);
		const fx = P.x - Q.x;
		const fy = P.y - Q.y;
		if (fx * fx + fy * fy < 1e-18) {
			break;
		}
		const dA = derivative(cA, tA);
		const dB = derivative(cB, tB);
		// J = [dA.x, -dB.x; dA.y, -dB.y]
		const det = dA.x * -dB.y - -dB.x * dA.y;
		if (Math.abs(det) < 1e-12) {
			break;
		}
		const du = (-fx * -dB.y - -dB.x * -fy) / det;
		const dv = (dA.x * -fy - -fx * dA.y) / det;
		tA += du;
		tB += dv;
		if (tA < 0) tA = 0;
		else if (tA > 1) tA = 1;
		if (tB < 0) tB = 0;
		else if (tB > 1) tB = 1;
	}
	const e = 1e-6;
	if (tA <= e || tA >= 1 - e || tB <= e || tB >= 1 - e) {
		return null;
	}
	return { tA, tB };
}

function derivative(curve: Curve<Vector2>, t: number): Vector2 {
	const h = 1e-5;
	const a = curve.getPoint(Math.max(0, t - h));
	const b = curve.getPoint(Math.min(1, t + h));
	return b.sub(a).multiplyScalar(1 / (2 * h));
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

// Deduplicate + sort split parameters, dropping any at the curve endpoints.
function cleanParams(params: number[] | undefined): number[] {
	if (!params || params.length === 0) {
		return [];
	}
	const sorted = [...params].sort((a, b) => a - b);
	const out: number[] = [];
	for (const t of sorted) {
		if (t <= 1e-6 || t >= 1 - 1e-6) {
			continue;
		}
		if (out.length && t - out[out.length - 1] < 1e-6) {
			continue;
		}
		out.push(t);
	}
	return out;
}

function splitCurve(curve: Curve<Vector2>, t0: number, t1: number): Curve<Vector2> {
	if (curve instanceof LineCurve) {
		return new LineCurve(lerpV(curve.v1, curve.v2, t0), lerpV(curve.v1, curve.v2, t1));
	}
	if (curve instanceof QuadraticBezierCurve) {
		const p = subBezier([curve.v0, curve.v1, curve.v2], t0, t1);
		return new QuadraticBezierCurve(p[0], p[1], p[2]);
	}
	if (curve instanceof CubicBezierCurve) {
		const p = subBezier([curve.v0, curve.v1, curve.v2, curve.v3], t0, t1);
		return new CubicBezierCurve(p[0], p[1], p[2], p[3]);
	}
	// Fallback for Spline/Ellipse fragments: approximate with a straight chord.
	return new LineCurve(curve.getPoint(t0), curve.getPoint(t1));
}

// Extract the control points of the sub-curve over [t0, t1] via de Casteljau.
function subBezier(pts: Vector2[], t0: number, t1: number): Vector2[] {
	let p = pts.map((v) => v.clone());
	if (t1 < 1) {
		p = deCasteljau(p, t1)[0];
	}
	if (t0 > 0) {
		const tt = t1 > 0 ? t0 / t1 : 0;
		p = deCasteljau(p, tt)[1];
	}
	return p;
}

// Split a Bezier (any degree) at t, returning [leftControlPts, rightControlPts].
function deCasteljau(pts: Vector2[], t: number): [Vector2[], Vector2[]] {
	const left: Vector2[] = [];
	const right: Vector2[] = [];
	let cur = pts.map((v) => v.clone());
	left.push(cur[0].clone());
	right.push(cur[cur.length - 1].clone());
	while (cur.length > 1) {
		const next: Vector2[] = [];
		for (let i = 0; i < cur.length - 1; i++) {
			next.push(cur[i].clone().lerp(cur[i + 1], t));
		}
		left.push(next[0].clone());
		right.unshift(next[next.length - 1].clone());
		cur = next;
	}
	return [left, right];
}

function lerpV(a: Vector2, b: Vector2, t: number): Vector2 {
	return a.clone().lerp(b, t);
}

// ---------------------------------------------------------------------------
// Inside / outside (winding)
// ---------------------------------------------------------------------------

function makeInsideTest(
	polylines: Vector2[][],
	rule: WindingRule
): (p: Vector2) => boolean {
	return (p: Vector2) => {
		let wn = 0;
		let crossings = 0;
		for (const poly of polylines) {
			const n = poly.length;
			for (let i = 0; i < n; i++) {
				const a = poly[i];
				const b = poly[(i + 1) % n];
				// non-zero winding number
				if (a.y <= p.y) {
					if (b.y > p.y && isLeft(a, b, p) > 0) {
						wn++;
					}
				} else if (b.y <= p.y && isLeft(a, b, p) < 0) {
					wn--;
				}
				// even-odd crossing count (ray towards +x)
				if (a.y > p.y !== b.y > p.y) {
					const xint = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
					if (p.x < xint) {
						crossings++;
					}
				}
			}
		}
		return rule === 'evenodd' ? (crossings & 1) === 1 : wn !== 0;
	};
}

function isLeft(a: Vector2, b: Vector2, p: Vector2): number {
	return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}

// ---------------------------------------------------------------------------
// Reconnection
// ---------------------------------------------------------------------------

// Merge node ids of "dangling" endpoints (where the count of fragments
// starting differs from the count ending) that lie within `tol` of one another,
// then drop any fragment that collapses to a point. Only dangling nodes are
// candidates, so well-formed loops (every node balanced) are never touched;
// `tol` is kept well below the smallest real glyph feature. Mutates `fragments`
// in place (remapping node ids) and removes collapsed fragments.
function weldDanglingEndpoints(fragments: Fragment[], nodes: NodeRegistry, tol: number): void {
	const outDeg = new Map<number, number>();
	const inDeg = new Map<number, number>();
	for (const f of fragments) {
		outDeg.set(f.startNode, (outDeg.get(f.startNode) ?? 0) + 1);
		inDeg.set(f.endNode, (inDeg.get(f.endNode) ?? 0) + 1);
	}
	const dangling: number[] = [];
	const seen = new Set<number>();
	for (const id of [...outDeg.keys(), ...inDeg.keys()]) {
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		if ((outDeg.get(id) ?? 0) !== (inDeg.get(id) ?? 0)) {
			dangling.push(id);
		}
	}
	if (dangling.length < 2) {
		return;
	}

	// Union-find over dangling nodes within tolerance.
	const parent = new Map<number, number>(dangling.map((id) => [id, id]));
	const find = (x: number): number => {
		let r = x;
		while (parent.get(r)! !== r) {
			r = parent.get(r)!;
		}
		while (parent.get(x)! !== r) {
			const next = parent.get(x)!;
			parent.set(x, r);
			x = next;
		}
		return r;
	};
	const tol2 = tol * tol;
	for (let i = 0; i < dangling.length; i++) {
		for (let j = i + 1; j < dangling.length; j++) {
			if (distSq(nodes.point(dangling[i]), nodes.point(dangling[j])) <= tol2) {
				parent.set(find(dangling[i]), find(dangling[j]));
			}
		}
	}

	for (let i = fragments.length - 1; i >= 0; i--) {
		const f = fragments[i];
		if (parent.has(f.startNode)) {
			f.startNode = find(f.startNode);
		}
		if (parent.has(f.endNode)) {
			f.endNode = find(f.endNode);
		}
		if (f.startNode === f.endNode) {
			fragments.splice(i, 1);
		}
	}
}

function traceLoops(fragments: Fragment[]): Loop[] {
	const used = new Set<Fragment>();
	const outgoing = new Map<number, Fragment[]>();
	for (const f of fragments) {
		let arr = outgoing.get(f.startNode);
		if (!arr) {
			arr = [];
			outgoing.set(f.startNode, arr);
		}
		arr.push(f);
	}

	const loops: Loop[] = [];
	for (const start of fragments) {
		if (used.has(start)) {
			continue;
		}
		const chain: Fragment[] = [];
		let cur: Fragment | null = start;
		while (cur && !used.has(cur)) {
			used.add(cur);
			chain.push(cur);
			const candidates = (outgoing.get(cur.endNode) || []).filter((f) => !used.has(f));
			if (candidates.length === 0) {
				cur = null;
				break;
			}
			cur = candidates.length === 1 ? candidates[0] : chooseNext(cur, candidates);
		}
		// Accept only properly closed loops.
		if (chain.length >= 2 && chain[chain.length - 1].endNode === chain[0].startNode) {
			loops.push(makeLoop(chain));
		}
	}
	return loops;
}

// At a node, continue along the outgoing edge that keeps the inside on the
// left: the one with the smallest counter-clockwise angle measured from the
// reverse of the incoming direction.
function chooseNext(incoming: Fragment, candidates: Fragment[]): Fragment {
	const inDir = tangentAt(incoming.curve, 1);
	const rAng = Math.atan2(-inDir.y, -inDir.x);
	let best = candidates[0];
	let bestAng = Infinity;
	for (const c of candidates) {
		const outDir = tangentAt(c.curve, 0);
		let d = Math.atan2(outDir.y, outDir.x) - rAng;
		while (d <= 1e-9) {
			d += Math.PI * 2;
		}
		while (d > Math.PI * 2) {
			d -= Math.PI * 2;
		}
		if (d < bestAng) {
			bestAng = d;
			best = c;
		}
	}
	return best;
}

function makeLoop(fragments: Fragment[]): Loop {
	const points = loopPoints(fragments);
	return { fragments, points, area: signedArea(points) };
}

// ---------------------------------------------------------------------------
// Grouping into Shapes
// ---------------------------------------------------------------------------

function buildShapes(loops: Loop[], inputShapes: Array<Shape>): Array<Shape> {
	if (loops.length === 0) {
		return [];
	}

	// Outer loops and holes are oppositely wound (inside-on-left makes outers
	// and holes opposite). The largest loop is necessarily an outline; its
	// sign tells us which sign means "outline".
	let outerSign = 0;
	let maxArea = -Infinity;
	for (const l of loops) {
		if (Math.abs(l.area) > maxArea) {
			maxArea = Math.abs(l.area);
			outerSign = Math.sign(l.area);
		}
	}

	const outers: Loop[] = [];
	const holes: Loop[] = [];
	for (const l of loops) {
		if (Math.sign(l.area) === outerSign) {
			outers.push(l);
		} else {
			holes.push(l);
		}
	}

	// Match the winding convention of the input outlines so downstream code
	// (which assumes a fixed orientation) keeps working.
	const wantOuterClockwise = inputOuterClockwise(inputShapes);

	const outerShapes = outers.map((outer) => {
		const oriented = orientLoop(outer, wantOuterClockwise);
		const shape = new Shape();
		shape.curves = oriented.fragments.map((f) => f.curve);
		shape.autoClose = false;
		return { shape, loop: oriented };
	});

	for (const hole of holes) {
		const oriented = orientLoop(hole, !wantOuterClockwise);
		const sample = oriented.points[0];
		// Assign the hole to the smallest outline that contains it.
		let target: (typeof outerShapes)[number] | null = null;
		let targetArea = Infinity;
		for (const cand of outerShapes) {
			if (pointInPolygon(sample, cand.loop.points)) {
				const a = Math.abs(cand.loop.area);
				if (a < targetArea) {
					targetArea = a;
					target = cand;
				}
			}
		}
		if (target) {
			const path = new Path();
			path.curves = oriented.fragments.map((f) => f.curve);
			target.shape.holes.push(path);
		}
	}

	return outerShapes.map((o) => o.shape);
}

function orientLoop(loop: Loop, clockwise: boolean): Loop {
	if (ShapeUtils.isClockWise(loop.points) === clockwise) {
		return loop;
	}
	const fragments = loop.fragments
		.slice()
		.reverse()
		.map((f) => ({
			curve: reverseCurve(f.curve),
			startNode: f.endNode,
			endNode: f.startNode
		}));
	const points = loop.points.slice().reverse();
	return { fragments, points, area: -loop.area };
}

function inputOuterClockwise(shapes: Array<Shape>): boolean {
	for (const s of shapes) {
		if (s.curves.length) {
			try {
				return ShapeUtils.isClockWise(s.getPoints());
			} catch {
				// fall through to default
			}
		}
	}
	return true;
}

function pointInPolygon(p: Vector2, poly: Vector2[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const vi = poly[i];
		const vj = poly[j];
		if (
			vi.y > p.y !== vj.y > p.y &&
			p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x
		) {
			inside = !inside;
		}
	}
	return inside;
}

// ---------------------------------------------------------------------------
// Curve helpers
// ---------------------------------------------------------------------------

function reverseCurve(c: Curve<Vector2>): Curve<Vector2> {
	if (c instanceof LineCurve) {
		return new LineCurve(c.v2.clone(), c.v1.clone());
	}
	if (c instanceof QuadraticBezierCurve) {
		return new QuadraticBezierCurve(c.v2.clone(), c.v1.clone(), c.v0.clone());
	}
	if (c instanceof CubicBezierCurve) {
		return new CubicBezierCurve(c.v3.clone(), c.v2.clone(), c.v1.clone(), c.v0.clone());
	}
	// Should not happen: fragments are only Line/Quad/Cubic.
	return new LineCurve(c.getPoint(1), c.getPoint(0));
}

function setCurveStart(c: Curve<Vector2>, p: Vector2) {
	if (c instanceof LineCurve) {
		c.v1.copy(p);
	} else if (c instanceof QuadraticBezierCurve || c instanceof CubicBezierCurve) {
		c.v0.copy(p);
	}
}

function setCurveEnd(c: Curve<Vector2>, p: Vector2) {
	if (c instanceof LineCurve) {
		c.v2.copy(p);
	} else if (c instanceof QuadraticBezierCurve) {
		c.v2.copy(p);
	} else if (c instanceof CubicBezierCurve) {
		c.v3.copy(p);
	}
}

function tangentAt(c: Curve<Vector2>, t: number): Vector2 {
	const h = 1e-4;
	const a = c.getPoint(Math.max(0, t - h));
	const b = c.getPoint(Math.min(1, t + h));
	return b.sub(a);
}

function samplePoints(c: Curve<Vector2>): Vector2[] {
	if (c instanceof LineCurve) {
		return [c.v1.clone(), c.v2.clone()];
	}
	return c.getPoints(8);
}

function loopPoints(fragments: Fragment[]): Vector2[] {
	const points: Vector2[] = [];
	for (const f of fragments) {
		const pts = samplePoints(f.curve);
		for (const p of pts) {
			const last = points[points.length - 1];
			if (last && near(last, p, 1e-7)) {
				continue;
			}
			points.push(p);
		}
	}
	if (points.length > 1 && near(points[0], points[points.length - 1], 1e-7)) {
		points.pop();
	}
	return points;
}

// ---------------------------------------------------------------------------
// Small geometry utilities
// ---------------------------------------------------------------------------

class NodeRegistry {
	private nodes: Vector2[] = [];
	private eps2: number;
	constructor(epsilon: number) {
		this.eps2 = epsilon * epsilon;
	}
	id(p: Vector2): number {
		for (let i = 0; i < this.nodes.length; i++) {
			if (distSq(this.nodes[i], p) <= this.eps2) {
				return i;
			}
		}
		this.nodes.push(p.clone());
		return this.nodes.length - 1;
	}
	point(id: number): Vector2 {
		return this.nodes[id];
	}
}

function signedArea(points: Vector2[]): number {
	let a = 0;
	const n = points.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		a += points[j].x * points[i].y - points[i].x * points[j].y;
	}
	return a * 0.5;
}

function distSq(a: Vector2, b: Vector2): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy;
}

function near(a: Vector2, b: Vector2, eps: number): boolean {
	return distSq(a, b) <= eps * eps;
}

function distToSegmentSq(p: Vector2, a: Vector2, b: Vector2): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	if (l2 === 0) {
		return distSq(p, a);
	}
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
	if (t < 0) t = 0;
	else if (t > 1) t = 1;
	const cx = a.x + t * dx;
	const cy = a.y + t * dy;
	const ex = p.x - cx;
	const ey = p.y - cy;
	return ex * ex + ey * ey;
}
