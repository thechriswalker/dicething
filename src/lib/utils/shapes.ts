import {
	ArcCurve,
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
	Vector2,
	Vector3
} from 'three';

// check the inner shapes are fully contained in an outer shape.
// ALL OUTER SHAPES ARE ASSUMED TO BE CONVEX POLYGONS
// this reduces the problem to all points on inner are inside outer.
// we can check this by checking each point in the inner shapes are
// on the same side of all edges of the outer shape.
const _edge = new Vector2();
const _a = new Vector2();
export function isContained(outer: Shape, inner: Array<Shape>): boolean {
	if (inner.length === 0) {
		return true;
	}
	const d = _isContainedAndMinDistanceToEdge(outer, inner);
	return d > 0;
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
			for (let p of s.getPoints(12)) {
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

	const axis = plusZ.clone().cross(normal).normalize();
	const angle = -plusZ.angleTo(normal);
	_q.setFromAxisAngle(axis, angle);
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

export function findBestLegendScalingFactor(shape: Shape, legends: Array<Shape>): number {
	let scale = 1;
	let minDistanceToEdge = _isContainedAndMinDistanceToEdge(shape, legends);
	// so we don't have to check for oscillation we move only in one direction, then half our step on
	// a reversal.
	let step = 0.4;
	// we will fake the direction as being the way we want to move first.
	let isShrinking = minDistanceToEdge < minAcceptableDistance;
	let i = 0;
	while (minDistanceToEdge < minAcceptableDistance || minDistanceToEdge > maxAcceptableDistance) {
		i++;
		// console.log({
		// 	distanceToEdge: minDistanceToEdge,
		// 	scale,
		// 	step,
		// 	isShrinking,
		// 	i
		// });
		if (minDistanceToEdge < minAcceptableDistance) {
			// current edge distance is too close. we need to get smaller (making the distance bigger)
			if (!isShrinking) {
				// we were getting bigger, we should halve our step and
				// switch to a shrink
				step = step / 2;
				isShrinking = true;
			}
			scale -= step;
		} else {
			// current distance to the edge is too big, i.e. legend is too small.
			// now we need to get bigger
			if (isShrinking) {
				// we were shrinking, half and get bigger.
				step = step / 2;
				isShrinking = false;
			}
			scale += step;
		}
		const testLegends = scaleShapes(scale, ...legends);
		minDistanceToEdge = _isContainedAndMinDistanceToEdge(shape, testLegends);
		if (i > 100) {
			throw new Error('not converging (probably a developer error...)');
			//return 1;
		}
	}
	//console.log({ final_distance: minDistanceToEdge, scale });
	return scale;
}
