import {
	CubicBezierCurve,
	EllipseCurve,
	LineCurve,
	Path,
	QuadraticBezierCurve,
	Shape,
	SplineCurve,
	Vector2,
	type Curve
} from 'three';

// map an array of anything, but clamp all numbers to max 6 dp
function fp(v: any) {
	if (typeof v === 'number') {
		return parseFloat(v.toFixed(6));
	}
	return v;
}

// we have custom functions as the JSON created by three has metadata,
// yes, it is good, but it's not very compact...
// I'm almost tempted to convert to SVG, as that is super compact.
// or at least a compact representation.
/// SVG paths have:
// "L x y" line from current position to line position.
// "H | V " horizontal or vertical lines
// "Z" close path
// "C" cubic bezier
// "Q" quad bezier
// "A" ellipse / arc curve.

// so those mean that we basically only have those types of curves in threejs
//
// - LineCurve
// - QuadraticBezierCurve
// - CubicBezierCurve
// - EllipseCurve
//
// which leaves out a SplineCurve.
// I guess we can encode that though...

function serialiseCurve(c: Curve<Vector2>): any {
	if (c instanceof LineCurve) {
		return ['L', c.v1.x, c.v1.y, c.v2.x, c.v2.y].map(fp);
	}
	if (c instanceof QuadraticBezierCurve) {
		return ['Q', c.v0.x, c.v0.y, c.v1.x, c.v1.y, c.v2.x, c.v2.y].map(fp);
	}
	if (c instanceof CubicBezierCurve) {
		return ['C', c.v0.x, c.v0.y, c.v1.x, c.v1.y, c.v2.x, c.v2.y, c.v3.x, c.v3.y].map(fp);
	}
	if (c instanceof EllipseCurve) {
		return [
			'A',
			c.aX,
			c.aY,
			c.xRadius,
			c.yRadius,
			c.aStartAngle,
			c.aEndAngle,
			c.aClockwise,
			c.aRotation
		].map(fp);
	}
	if (c instanceof SplineCurve) {
		return ['S', ...c.points.flatMap((p) => [p.x, p.y])].map(fp);
	}
	throw new Error('unsupported curve');
}

// none are robust against bad data...
function deserialiseCurve(a: any): Curve<Vector2> {
	if (!Array.isArray(a)) {
		throw new Error('unsupported serialisation');
	}
	switch (a[0]) {
		case 'L':
			return new LineCurve(new Vector2(a[1], a[2]), new Vector2(a[3], a[4]));
		case 'Q':
			return new QuadraticBezierCurve(
				new Vector2(a[1], a[2]),
				new Vector2(a[3], a[4]),
				new Vector2(a[5], a[6])
			);
		case 'C':
			return new CubicBezierCurve(
				new Vector2(a[1], a[2]),
				new Vector2(a[3], a[4]),
				new Vector2(a[5], a[6]),
				new Vector2(a[7], a[8])
			);
		case 'E':
			return new EllipseCurve(...a.slice(1));
		case 'S':
			return new SplineCurve(
				a.slice(1).reduce((p, c, i) => {
					if (i % 2 == 0) {
						// this is even
						p.push(new Vector2(c));
					} else {
						p[p.length - 1].y = c;
					}
					return p;
				}, [])
			);
		default:
			throw new Error('unsupported curve type');
	}
}

export function shapeToJSON(s: Shape): any {
	// a Shape is basically a set of curves, maybe with some holes in it.
	// we have also need the "autoClose" just in case.
	const x = {
		c: s.curves.map(serialiseCurve)
	} as any;
	if (s.autoClose) {
		x.a = 1;
	}
	if (s.holes.length > 0) {
		x.h = s.holes.map((p) => p.curves.map(serialiseCurve));
	}
	return x;
}

export function shapeFromJSON(obj: any): Shape {
	const s = new Shape();
	s.autoClose = !!obj.a;
	s.curves = obj.c.map(deserialiseCurve);
	if (obj.h) {
		s.holes = obj.h.map((p: any) => {
			const x = new Path();
			x.curves = p.map(deserialiseCurve);
			return x;
		});
	}
	return s;
}
