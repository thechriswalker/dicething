import {
	ArcCurve,
	Box2,
	CubicBezierCurve,
	Curve,
	EllipseCurve,
	LineCurve,
	Path,
	Plane,
	QuadraticBezierCurve,
	Quaternion,
	Shape,
	SplineCurve,
	Triangle,
	Vector2,
	Vector3
} from 'three';
import { unionBoundaryLoops } from './tessellate';

// check the inner shapes are fully contained in an outer shape.
// ALL OUTER SHAPES ARE ASSUMED TO BE CONVEX POLYGONS
// this reduces the problem to all points on inner are inside outer.
// we can check this by checking each point in the inner shapes are
// on the same side of all edges of the outer shape.
const _edge = new Vector2();
const _a = new Vector2();
// Is every inner shape contained in `outer` leaving more than `threshold`
// clearance from its boundary? `convex` (the default) uses the fast half-plane
// test that assumes a convex outer; pass `false` for a possibly-concave outer
// (e.g. a custom coin outline) to use the general point-in-polygon + edge-cross
// test instead. Only ever set false where `outer` can actually be concave - the
// general path is slower and the convex path is correct everywhere else.
export function isContained(
	outer: Shape,
	inner: Array<Shape>,
	threshold: number = 0,
	convex: boolean = true
): boolean {
	if (inner.length === 0) {
		return true;
	}
	const d = convex
		? _isContainedAndMinDistanceToEdge(outer, inner)
		: _minClearanceGeneral(outer, inner);
	return d > threshold;
}

function _isContainedAndMinDistanceToEdge(outer: Shape, inner: Array<Shape>): number {
	// all points need to be on the same side of each segment of the outer.
	const outerPoints = outer.getPoints();
	if (outerPoints[0] === outerPoints[outerPoints.length - 1]) {
		outerPoints.pop(); // remove duplicate start/end points
	}
	// we also know that the shape is clockwise. so all points should be on the right of each vector.
	let minDistance = Infinity;
	for (let i = 0; i < outerPoints.length; i++) {
		_edge.copy(outerPoints[(i + 1) % outerPoints.length]); // set edge to second point
		_edge.sub(outerPoints[i]); // subtract first to get the correct vector for the edge.
		let [pos, neg] = [false, false];
		for (let s of inner) {
			// we lower this for speed vs. accuracy
			// we add the origin to force a point on the inside of the outer shape.
			// this way, we can detect a "fully outside" shape.
			for (let p of s.getPoints(12).concat(origin)) {
				// is p on the right?
				_a.copy(p);
				_a.sub(outerPoints[i]);
				const c = _edge.cross(_a);
				if (c > 0) {
					if (neg) {
						return -1;
					}
					pos = true;
				}
				if (c < 0) {
					if (pos) {
						return -1;
					}
					neg = true;
				}
				const d = distanceFromLineToPoint(_edge, _a);
				if (d < minDistance) {
					minDistance = d;
				}
			}
		}
	}
	return minDistance;
}

// is the point (x,y) inside the (possibly concave) polygon `poly`? standard
// even-odd ray cast. `poly` must be an open loop (no duplicated closing point).
function pointInPolygon(x: number, y: number, poly: Array<Vector2>): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const vi = poly[i];
		const vj = poly[j];
		const crosses =
			vi.y > y !== vj.y > y && x < ((vj.x - vi.x) * (y - vi.y)) / (vj.y - vi.y) + vi.x;
		if (crosses) {
			inside = !inside;
		}
	}
	return inside;
}

function pointToSegmentDistance(px: number, py: number, a: Vector2, b: Vector2): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	let t = lenSq === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));
	const cx = a.x + t * dx;
	const cy = a.y + t * dy;
	return Math.hypot(px - cx, py - cy);
}

// shortest distance between two segments: 0 if they touch/cross, else the
// smallest of the four endpoint-to-opposite-segment distances.
function segmentDistance(a: Vector2, b: Vector2, c: Vector2, d: Vector2): number {
	if (intersect(a, b, c, d)) {
		return 0;
	}
	return Math.min(
		pointToSegmentDistance(a.x, a.y, c, d),
		pointToSegmentDistance(b.x, b.y, c, d),
		pointToSegmentDistance(c.x, c.y, a, b),
		pointToSegmentDistance(d.x, d.y, a, b)
	);
}

// General (possibly concave) analogue of `_isContainedAndMinDistanceToEdge`,
// with the same contract: returns -1 when the inner shapes are not fully inside
// `outer`, otherwise the minimum distance from any inner edge to the outer
// boundary. Containment is decided by point-in-polygon (valid for any simple
// polygon) plus an edge-crossing test - a shape poking out through a concavity
// has vertices inside but an edge that crosses the boundary. The reported
// clearance uses segment-to-segment distance, so a reflex corner of the outline
// (not just an edge) can be the limiting feature.
function _minClearanceGeneral(outer: Shape, inner: Array<Shape>): number {
	const outerPoints = outer.getPoints();
	if (
		outerPoints.length > 1 &&
		outerPoints[0].distanceToSquared(outerPoints[outerPoints.length - 1]) < 1e-12
	) {
		outerPoints.pop();
	}
	const n = outerPoints.length;
	if (n < 3) {
		return -1;
	}
	let minDistance = Infinity;
	for (const s of inner) {
		const innerPoints = s.getPoints(12);
		if (
			innerPoints.length > 1 &&
			innerPoints[0].distanceToSquared(innerPoints[innerPoints.length - 1]) < 1e-12
		) {
			innerPoints.pop();
		}
		const m = innerPoints.length;
		if (m < 2) {
			continue;
		}
		// every inner vertex must lie inside the outer polygon.
		for (const p of innerPoints) {
			if (!pointInPolygon(p.x, p.y, outerPoints)) {
				return -1;
			}
		}
		// no inner edge may touch/cross an outer edge; track the closest approach.
		for (let i = 0; i < m; i++) {
			const a = innerPoints[i];
			const b = innerPoints[(i + 1) % m];
			for (let j = 0; j < n; j++) {
				const c = outerPoints[j];
				const d = outerPoints[(j + 1) % n];
				const dist = segmentDistance(a, b, c, d);
				if (dist === 0) {
					return -1;
				}
				if (dist < minDistance) {
					minDistance = dist;
				}
			}
		}
	}
	return minDistance;
}

export function anyOuterContainsInner(outer: Shape, inner: Shape): boolean {
	// need to to the line-crossing algo.
	// we will do this in super rough divisions
	const outerPoints = outer.getPoints(6);
	if (outerPoints[0] === outerPoints[outerPoints.length - 1]) {
		outerPoints.pop(); // remove duplicate start/end points
	}
	const innerPoints = inner.getPoints(6);
	if (innerPoints[0] === innerPoints[innerPoints.length - 1]) {
		innerPoints.pop(); // remove duplicate start/end points
	}
	for (let i = 0; i < outerPoints.length; i++) {
		const v1 = outerPoints[i];
		const v2 = outerPoints[(i + 1) % outerPoints.length];
		for (let j = 0; j < innerPoints.length; j++) {
			const v3 = innerPoints[j];
			const v4 = innerPoints[(j + 1) % innerPoints.length];
			if (intersect(v1, v2, v3, v4)) {
				return false;
			}
		}
	}
	// no intersections, so is there a single point inside?
	return anyInside(outerPoints, innerPoints);
}

function anyInside(outer: Array<Vector2>, inner: Array<Vector2>): boolean {
	for (let { x, y } of inner) {
		let inside = false;
		for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
			let vi = outer[i];
			let vj = outer[j];
			const intersect =
				vi.y > y != vj.y > y && x < ((vj.x - vi.x) * (y - vi.y)) / (vj.y - vi.y) + vi.x;
			if (intersect) {
				inside = !inside;
			}
		}
		if (inside) {
			return true;
		}
	}
	return false;
}

function intersect(v1: Vector2, v2: Vector2, v3: Vector2, v4: Vector2): boolean {
	// Check if none of the lines are of length 0
	if ((v1.x === v2.x && v1.y === v2.y) || (v3.x === v4.x && v3.y === v4.y)) {
		return false;
	}

	const denominator = (v4.y - v3.y) * (v2.x - v1.x) - (v4.x - v3.x) * (v2.y - v1.y);

	// Lines are parallel
	if (denominator === 0) {
		return false;
	}

	let ua = ((v4.x - v3.x) * (v1.y - v3.y) - (v4.y - v3.y) * (v1.x - v3.x)) / denominator;
	let ub = ((v2.x - v1.x) * (v1.y - v3.y) - (v2.y - v1.y) * (v1.x - v3.x)) / denominator;

	// is the intersection along the segments
	if (ua < 0 || ua > 1 || ub < 0 || ub > 1) {
		return false;
	}
	// we only care about IF the intersect not where
	return true;

	// // Return a object with the x and y coordinates of the intersection
	//   let x = x1 + ua * (x2 - x1)
	//   let y = y1 + ua * (y2 - y1)

	//   return {x, y}
}

// assumes bot line and point are relative to the origin.
// we also work out the distance from the distance from the origin of
// the line and crosses the origin and the point and the given line.
// this way we can work out if the point is "outside the origin."
function distanceFromLineToPoint(line: Vector2, point: Vector2): number {
	const dot = line.dot(point);
	const d2 = line.lengthSq();
	const t = dot / d2;
	const dx = _a.x - t * _edge.x;
	const dy = _a.y - t * _edge.y;
	return Math.sqrt(dx * dx + dy * dy);
}

export function minDistanceToBoundary(outer: Shape, inner: Array<Shape>): number {
	if (inner.length === 0) {
		return 1;
	}
	return _isContainedAndMinDistanceToEdge(outer, inner);
}

// re-use these
const _min = new Vector2();
const _max = new Vector2();
const _off = new Vector2();

// moves a set of shapes to the origin, keeping relative positions
// creates clones of each one.
export function centerShapes(...shapes: Array<Shape>): Array<Shape> {
	_min.set(Infinity, Infinity);
	_max.set(-Infinity, -Infinity);
	shapes.forEach((s) =>
		s.getPoints().forEach((p) => {
			if (p.x < _min.x) {
				_min.x = p.x;
			}
			if (p.x > _max.x) {
				_max.x = p.x;
			}
			if (p.y < _min.y) {
				_min.y = p.y;
			}
			if (p.y > _max.y) {
				_max.y = p.y;
			}
		})
	);
	// we have the bounding box.
	// so we can find the current center.
	// set _v0 to the offset to move the shapes.
	_off.set(-(_min.x + _max.x) / 2, -(_min.y + _max.y) / 2);
	// how do we move this as a shape I don't want to move each point.
	return translateShapes(_off, ...shapes);
}

function transformShape(s: Shape, transformer: (c: Curve<Vector2>) => Curve<Vector2>): Shape {
	const n = new Shape();
	s.curves.forEach((c) => n.add(transformer(c)));
	s.holes.forEach((_h) => {
		const h = new Path();
		_h.curves.forEach((c) => h.add(transformer(c)));
		n.holes.push(h);
	});
	return n;
}

type CurveFunctions = {
	isLineCurve?: (lc: LineCurve) => Curve<Vector2>;
	isCubicBezierCurve?: (cbc: CubicBezierCurve) => Curve<Vector2>;
	isArcCurve?: (ac: ArcCurve) => Curve<Vector2>;
	isEllipseCurve?: (ec: EllipseCurve) => Curve<Vector2>;
	isQuadraticBezierCurve?: (qbc: QuadraticBezierCurve) => Curve<Vector2>;
	isSplineCurve?: (sc: SplineCurve) => Curve<Vector2>;
};

function curveTransformer(fns: CurveFunctions): (c: Curve<Vector2>) => Curve<Vector2> {
	return (c) => {
		if (fns.isArcCurve && !fns.isEllipseCurve) {
			fns.isEllipseCurve = fns.isArcCurve as any;
		} else if (fns.isEllipseCurve && !fns.isArcCurve) {
			fns.isArcCurve = fns.isEllipseCurve;
		}
		for (const [key, fn] of Object.entries(fns)) {
			if ((c as any)[key]) {
				return fn(c.clone() as any);
			}
		}
		console.warn('unsupported curve:', typeof c);
		return c;
	};
}
function curveTranslation(offset: Vector2) {
	return curveTransformer({
		isLineCurve: (lc) => {
			lc.v1.add(offset);
			lc.v2.add(offset);
			return lc;
		},
		isQuadraticBezierCurve: (qbc) => {
			qbc.v0.add(offset);
			qbc.v1.add(offset);
			qbc.v2.add(offset);
			return qbc;
		},
		isCubicBezierCurve: (cbc) => {
			cbc.v0.add(offset);
			cbc.v1.add(offset);
			cbc.v2.add(offset);
			cbc.v3.add(offset);
			return cbc;
		},
		isEllipseCurve: (ac) => {
			ac.aX += offset.x;
			ac.aY += offset.y;
			return ac;
		},
		isSplineCurve: (sc) => {
			sc.points.forEach((p) => p.add(offset));
			return sc;
		}
	});
}

// moves a shape in 2d, clones the shape
export function translateShapes(offset: Vector2, ...shapes: Array<Shape>): Array<Shape> {
	const transformer = curveTranslation(offset);
	return shapes.map((s) => transformShape(s, transformer));
}

// increase or decrease the size of a shape
// this is really hard, as we have to re-apply scaled versions of the curves.
// we can only scale a percentage here, not an absolute value.
// we will also scale the absolute position.
const _v = new Vector2();
export function curveScaler(factor: number) {
	return curveTransformer({
		isLineCurve: (lc) => {
			lc.v1.multiplyScalar(factor);
			lc.v2.multiplyScalar(factor);
			return lc;
		},
		isCubicBezierCurve: (cbc) => {
			cbc.v0.multiplyScalar(factor);
			cbc.v1.multiplyScalar(factor);
			cbc.v2.multiplyScalar(factor);
			cbc.v3.multiplyScalar(factor);
			return cbc;
		},
		isEllipseCurve: (ac) => {
			_v.set(ac.aX, ac.aY).multiplyScalar(factor);
			ac.aX = _v.x;
			ac.aY = _v.y;
			ac.xRadius *= factor;
			ac.yRadius *= factor;
			return ac;
		},
		isQuadraticBezierCurve: (qbc) => {
			qbc.v0.multiplyScalar(factor);
			qbc.v1.multiplyScalar(factor);
			qbc.v2.multiplyScalar(factor);
			return qbc;
		},
		isSplineCurve: (sc) => {
			sc.points.forEach((p) => p.multiplyScalar(factor));
			return sc;
		}
	});
}

export function scaleShapes(factor: number, ...shapes: Array<Shape>): Array<Shape> {
	// basically we have to get all curves in the shape (and the holes)
	// I am going to assume that all start/end points on the curves end up scaling the same...
	const transformer = curveScaler(factor);
	return shapes.map((s) => transformShape(s, transformer));
}

const origin = new Vector2();
function curveRotator(angle: number) {
	return curveTransformer({
		isLineCurve: (lc) => {
			// this is easy.
			lc.v1.rotateAround(origin, angle);
			lc.v2.rotateAround(origin, angle);
			return lc;
		},
		isEllipseCurve: (ec) => {
			// rotate the centerpoint, and update the elliptic rotation.
			_v.set(ec.aX, ec.aY).rotateAround(origin, angle);
			ec.aX = _v.x;
			ec.aY = _v.y;
			ec.aRotation += angle;
			return ec;
		},
		isSplineCurve: (sc) => {
			// this is just the points.
			sc.points = sc.points.map((p) => p.rotateAround(origin, angle));
			return sc;
		},
		// beziers?
		isQuadraticBezierCurve: (qbc) => {
			qbc.v0.rotateAround(origin, angle);
			qbc.v1.rotateAround(origin, angle);
			qbc.v2.rotateAround(origin, angle);
			return qbc;
		},
		isCubicBezierCurve: (cbc) => {
			cbc.v0.rotateAround(origin, angle);
			cbc.v1.rotateAround(origin, angle);
			cbc.v2.rotateAround(origin, angle);
			cbc.v3.rotateAround(origin, angle);
			return cbc;
		}
	});
}

// we will assume the shapes are centered on the origin before rotation.
// our order of operations should be:
// center -> scale -> rotate -> translate.
// this keeps the rotation simple
export function rotateShapes(angle: number, ...shapes: Array<Shape>): Array<Shape> {
	const transformer = curveRotator(angle);
	return shapes.map((s) => transformShape(s, transformer));
}

// take a set of co-planar vertices in 3-space and convert to a centered "shape".
// should be AT LEAST 3 vertices
// we don't check they are co-planar or how many.
// returns the offset and the normal of the center, to use to "re-orient" the shape
// again later (which is much easier as we have an object3D by then)
const _p = new Plane();
const _q = new Quaternion();
const plusZ = new Vector3(0, 0, 1);
export function orientCoplanarVertices(vertices: Array<Vector3>): {
	shape: Shape;
	offset: Vector3;
	normal: Vector3;
	quat: Quaternion;
} {
	if (vertices.length < 3) {
		throw new Error('need at least 3 vertices to make a plane');
	}

	const center = new Vector3();
	// find the centroid and a "normal"
	center.set(0, 0, 0);
	for (let v of vertices) {
		center.add(v);
	}
	center.divideScalar(vertices.length);
	const normal = new Vector3();
	const moved = vertices.map((v) => v.clone().sub(center));
	_p.setFromCoplanarPoints(moved[0], moved[1], moved[2]);
	normal.copy(_p.normal);
	normal.normalize();

	// rotation that lays the face flat (maps its normal onto +z). using
	// setFromUnitVectors handles the degenerate case where the normal is
	// anti-parallel to +z (a face pointing straight down -z), where the old
	// `plusZ.cross(normal)` axis collapses to zero and normalising it produced a
	// NaN rotation - leaving that one face mis-oriented / invisible.
	_q.setFromUnitVectors(normal, plusZ);
	const inv = _q.clone().invert();
	const next = moved.map((v) => {
		if (_p.distanceToPoint(v) > 0.000001) {
			throw new Error('points are not co-planar: d=' + _p.distanceToPoint(v));
		}
		v.applyQuaternion(_q);
		if (v.z > 0.000001) {
			//throw new Error('orientation to Z plane did not work!');
		}
		return new Vector2(v.x, v.y);
	});
	const shape = new Shape(next);
	return { shape, offset: center, normal, quat: inv };
}

// attempt to fit the legend into the shape, with a target "distance" from the edge.
// but

// acceptable minimum distance to edge.
const minAcceptableDistance = 1;
const maxAcceptableDistance = 2;

// Find the scaling factor that fits the legend inside `shape` leaving a margin in
// the acceptable band. `tolerance` is the minimum inset a legend must keep from
// the edge: when larger than the default band it raises the target so legends
// auto-shrink to honor the inset. Defaults to 0 (the historical behaviour).
//
// The margin is monotonic in scale: a bigger legend sits closer to the edges, so
// `_isContainedAndMinDistanceToEdge` shrinks (and eventually returns -1 once the
// legend overflows). We exploit that to bracket-and-bisect for the largest scale
// whose inset is still >= the target, which always converges - the old
// fixed-step search could march `scale` negative or oscillate forever on wide
// glyphs / narrow faces and threw "not converging".
//
// A legend can always be made to fit: shrinking it collapses it toward the
// origin, where the inset approaches the face's inradius. If even that inradius
// is below the requested inset (the face is simply too small for the band) we
// drop the target to the largest inset the face can offer, so the symbol comes
// out small but still printable rather than failing.
export function findBestLegendScalingFactor(
	shape: Shape,
	legends: Array<Shape>,
	tolerance: number = 0,
	convex: boolean = true
): number {
	if (!legends || legends.length === 0) {
		return 1;
	}
	const minDist = Math.max(minAcceptableDistance, tolerance);
	const maxDist = minDist + (maxAcceptableDistance - minAcceptableDistance);

	// inset of the legend scaled by `scale`; -1 when it overflows the face. uses
	// the general (concave-safe) clearance when `convex` is false.
	const insetAt = (scale: number): number => {
		const scaled = scaleShapes(scale, ...legends);
		return convex
			? _isContainedAndMinDistanceToEdge(shape, scaled)
			: _minClearanceGeneral(shape, scaled);
	};

	// shrinking toward zero collapses the legend to (around) the origin, so this
	// is effectively the face's inradius - the most inset any legend can get.
	const TINY = 1e-3;
	const maxInset = insetAt(TINY);

	// the inset we aim to leave around the legend. normally the band's lower
	// bound (which yields the biggest legend that still honors the inset); for a
	// face too small to reach that, the best inset it can offer instead.
	const target = maxInset >= minDist ? minDist : Math.max(maxInset * 0.5, TINY);
	// the upper inset we're happy to accept (legend not needlessly small).
	const upper = maxInset >= minDist ? maxDist : maxInset;

	// bracket: `lo` fits (inset >= target), `hi` is too big (inset < target).
	let lo = TINY;
	let hi = TINY;
	let guard = 0;
	while (insetAt(hi) >= target && guard++ < 80 && isFinite(hi)) {
		lo = hi;
		hi *= 2;
	}
	if (insetAt(lo) < target) {
		// even the tiniest legend can't reach the target (degenerate / sub-unit
		// face). return something small but positive so we never emit a zero or
		// negative scale.
		return TINY;
	}

	// bisect for the largest scale with inset >= target, returning early once the
	// inset lands inside the [target, upper] band.
	for (let i = 0; i < 80 && hi - lo > 1e-4; i++) {
		const mid = (lo + hi) / 2;
		const inset = insetAt(mid);
		if (inset >= target) {
			lo = mid;
			if (inset <= upper) {
				return mid;
			}
		} else {
			hi = mid;
		}
	}
	return lo;
}

// Inset a convex polygon inward by `distance`, returning the new vertices. Each
// edge is offset toward the interior and consecutive offset lines are
// intersected to find the inset corners. Returns an empty array if the shape
// collapses (distance too large) and the original points (cloned) when distance
// <= 0. Used to compute the "available legend area": the convex face fit-shape
// minus the engraving tolerance.
export function insetConvexPolygon(shape: Shape, distance: number): Array<Vector2> {
	let pts = shape.getPoints();
	if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-9) {
		pts = pts.slice(0, -1);
	}
	const n = pts.length;
	if (n < 3) {
		return pts.map((p) => p.clone());
	}
	if (distance <= 0) {
		return pts.map((p) => p.clone());
	}
	// interior reference point. The polygon is convex, so its vertex average is
	// inside it (we can't assume the origin: e.g. the coin's inscribed-circle
	// fit-shape is centered on the pole of inaccessibility, not the origin).
	const centroid = new Vector2();
	for (const p of pts) {
		centroid.add(p);
	}
	centroid.multiplyScalar(1 / n);

	type Line = { p: Vector2; d: Vector2 };
	const lines: Array<Line> = [];
	for (let i = 0; i < n; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % n];
		const d = new Vector2().subVectors(b, a);
		if (d.lengthSq() < 1e-12) {
			continue;
		}
		d.normalize();
		// the perpendicular pointing toward the interior (the centroid).
		const nrm = new Vector2(-d.y, d.x);
		if (nrm.dot(new Vector2().subVectors(centroid, a)) < 0) {
			nrm.negate();
		}
		const p = new Vector2().copy(a).addScaledVector(nrm, distance);
		lines.push({ p, d });
	}
	const m = lines.length;
	if (m < 3) {
		return [];
	}
	const out: Array<Vector2> = [];
	for (let i = 0; i < m; i++) {
		const prev = lines[(i - 1 + m) % m];
		const cur = lines[i];
		const denom = prev.d.x * cur.d.y - prev.d.y * cur.d.x;
		if (Math.abs(denom) < 1e-9) {
			// parallel offset lines -> the polygon has collapsed.
			return [];
		}
		const diff = new Vector2().subVectors(cur.p, prev.p);
		const t = (diff.x * cur.d.y - diff.y * cur.d.x) / denom;
		out.push(new Vector2().copy(prev.p).addScaledVector(prev.d, t));
	}
	return out;
}

// Inset a (possibly concave) polygon inward by `distance`, returning one or more
// boundary loops (a concave inset can split into several, or vanish). For convex
// shapes this delegates to `insetConvexPolygon` (a single loop). For concave
// shapes each edge is offset inward - the inward side decided per-edge by a
// point-in-polygon probe so winding doesn't matter - and consecutive offset
// lines are intersected (miter joins). That raw loop self-overlaps near reflex
// corners, so it is cleaned through `unionBoundaryLoops` (libtess nonzero
// boundary mode), the same machinery that resolves self-touching glyph soup.
// Used to draw the "available legend area" aid; the containment maths is
// separate, so an approximate inset here is acceptable.
export function insetPolygon(
	shape: Shape,
	distance: number,
	convex: boolean = true
): Array<Array<Vector2>> {
	if (convex) {
		const loop = insetConvexPolygon(shape, distance);
		return loop.length >= 3 ? [loop] : [];
	}
	let pts = shape.getPoints();
	if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-9) {
		pts = pts.slice(0, -1);
	}
	const n = pts.length;
	if (n < 3) {
		return [];
	}
	if (distance <= 0) {
		return [pts.map((p) => p.clone())];
	}

	type Line = { p: Vector2; d: Vector2 };
	const lines: Array<Line> = [];
	const probe = new Vector2();
	for (let i = 0; i < n; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % n];
		const d = new Vector2().subVectors(b, a);
		if (d.lengthSq() < 1e-12) {
			continue;
		}
		d.normalize();
		// perpendicular, flipped so it points into the polygon interior.
		const nrm = new Vector2(-d.y, d.x);
		probe.addVectors(a, b).multiplyScalar(0.5).addScaledVector(nrm, 1e-3);
		if (!pointInPolygon(probe.x, probe.y, pts)) {
			nrm.negate();
		}
		const p = new Vector2().copy(a).addScaledVector(nrm, distance);
		lines.push({ p, d });
	}
	const m = lines.length;
	if (m < 3) {
		return [];
	}
	const offset: Array<Vector2> = [];
	for (let i = 0; i < m; i++) {
		const prev = lines[(i - 1 + m) % m];
		const cur = lines[i];
		const denom = prev.d.x * cur.d.y - prev.d.y * cur.d.x;
		if (Math.abs(denom) < 1e-9) {
			// (near) collinear consecutive edges: the offset start point is fine.
			offset.push(cur.p.clone());
			continue;
		}
		const diff = new Vector2().subVectors(cur.p, prev.p);
		const t = (diff.x * cur.d.y - diff.y * cur.d.x) / denom;
		offset.push(new Vector2().copy(prev.p).addScaledVector(prev.d, t));
	}
	return unionBoundaryLoops([offset]).filter((loop) => loop.length >= 3);
}

// find the area of a shape that is centered on the origin (like all our face shapes are)
const _t = new Triangle();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _o3 = new Vector3(0, 0, 0);
export function getAreaOfShapeAtOrigin(shape: Shape): number {
	const points = shape.getPoints();
	return points.reduce((total, point, idx) => {
		const p1 = points[idx + 1] || points[0];
		_v1.set(point.x, point.y, 0);
		_v2.set(p1.x, p1.y, 0);
		_t.set(_o3, _v1, _v2);
		return total + _t.getArea();
	}, 0);
}

function expandByPoints(box: Box2, points: Array<Vector2>) {
	for (let i = 0, il = points.length; i < il; i++) {
		box.expandByPoint(points[i]);
	}
}

export function getBoundingBox(shape: Shape, margin: number = 0): Box2 {
	let box = new Box2(new Vector2(0, 0), new Vector2(0, 0));
	const paths: string[] = [];
	expandByPoints(box, shape.getPoints());
	if (margin) {
		box.min.x -= margin;
		box.min.y -= margin;
		box.max.x += margin;
		box.max.y += margin;
	}
	return box;
}

export function shapesToSVG(shapes: Array<Shape>): SVGSVGElement {
	let box = new Box2(new Vector2(0, 0), new Vector2(0, 0));
	const paths: string[] = [];
	shapes.forEach((s) => {
		// include this in bounding box.
		try {
			expandByPoints(box, s.getPoints());
			// create the path.
			paths.push(toSVGPath(s));
		} catch (e) {
			console.error('failed processing shape', s);
			console.error(e);
		}
	});
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const boxSize = box.getSize(_v);
	svg.setAttribute('viewBox', `${box.min.x} ${box.min.y} ${boxSize.x} ${boxSize.y}`);
	paths.forEach((p) => {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', p);
		// even-odd so holes are cut regardless of their winding. SVGs authored with
		// fill-rule:evenodd can yield holes wound the same way as the outer contour
		// (createShapes still tags them as holes); nonzero would leave them filled.
		path.setAttribute('fill-rule', 'evenodd');
		svg.appendChild(path);
	});
	return svg;
}

export function shapesToSVGData(shapes: Array<Shape>): string {
	let box = new Box2(new Vector2(0, 0), new Vector2(0, 0));
	const paths: string[] = [];
	shapes.forEach((s) => {
		// include this in bounding box.
		try {
			expandByPoints(box, s.getPoints());
			// create the path.
			paths.push(toSVGPath(s));
		} catch (e) {
			console.error('failed processing shape', typeof s);
			console.error(e);
		}
	});
	const boxSize = box.getSize(_v);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.min.x} ${box.min.y} ${boxSize.x} ${boxSize.y}">
		<g transform="scale(1,-1)">
			${paths.map((p) => `<path fill-rule="evenodd" d="${p}" />`).join('\n')}
		</g>
	</svg>`;
}

// Lay out a sequence of glyph shape-sets (each centered on the origin) in a
// single row, left to right, with a uniform gap, and render them to an SVG data
// string. This mirrors the builtin previews (which render a string straight
// from the font) so custom legend sets can be given a comparable, evenly-spaced
// preview generated on the fly from their stored glyphs.
export function shapesRowToSVGData(glyphs: Array<Array<Shape>>, gap: number = 1.5): string {
	const placed: Array<Shape> = [];
	const box = new Box2();
	const size = new Vector2();
	let cursor = 0;
	for (const glyph of glyphs) {
		if (glyph.length === 0) {
			continue;
		}
		box.makeEmpty();
		glyph.forEach((s) => expandByPoints(box, s.getPoints()));
		if (box.isEmpty()) {
			continue;
		}
		box.getSize(size);
		// shift the glyph so its left edge sits at the running cursor.
		placed.push(...translateShapes(new Vector2(cursor - box.min.x, 0), ...glyph));
		cursor += size.x + gap;
	}
	return shapesToSVGData(placed);
}

function toSVGPath(s: Shape): string {
	const segments = appendSVGPathSegments([], s);
	s.holes.forEach((h) => {
		appendSVGPathSegments(segments, h);
	});
	return segments.join(' ');
}

function appendSVGPathSegments(segments: Array<string>, path: Path): Array<string> {
	const p = path.getPointAt(0, _v);
	segments.push(`M${p.x} ${p.y}`);
	path.curves.forEach((c, i) => {
		// we will use the curve transformer to make the next big easier.
		curveTransformer({
			isLineCurve: (lc) => {
				segments.push(`L${lc.v2.x} ${lc.v2.y}`);
				return lc;
			},
			isArcCurve: (ac) => {
				// get the end point
				ac.getPointAt(1, _v);
				const s = `A${ac.xRadius} ${ac.yRadius} ${ac.aRotation} ${ac.aEndAngle - ac.aStartAngle < Math.PI ? 0 : 1} ${ac.aClockwise ? 0 : 1} ${_v.x} ${_v.y}`;
				segments.push(s);
				return ac;
			},
			isSplineCurve: (sp) => {
				// this is an array of points
				sp.points.forEach((p) => {
					segments.push(`L${p.x} ${p.y}`);
				});
				return sp;
			},
			isCubicBezierCurve: (cbc) => {
				segments.push(`C${cbc.v1.x} ${cbc.v1.y}, ${cbc.v2.x} ${cbc.v2.y}, ${cbc.v3.x} ${cbc.v3.y}`);
				return cbc;
			},
			isQuadraticBezierCurve: (qbc) => {
				segments.push(`Q${qbc.v1.x} ${qbc.v1.y}, ${qbc.v2.x} ${qbc.v2.y}`);
				return qbc;
			}
		})(c);
	});
	segments.push('Z');
	return segments;
}
