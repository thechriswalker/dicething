import { BufferAttribute, BufferGeometry, Path, Shape, ShapeUtils, Vector2 } from 'three';
import { shapeGeometry, unionBoundaryLoops } from './tessellate';
import {
	anyOuterContainsInner,
	isContained,
	rotateShapes,
	scaleShapes,
	translateShapes
} from './shapes';
import type { FaceParams } from '$lib/interfaces/dice';

export const DefaultDivisions = 12;
// Coarser tessellation for live editor / thumbnail previews. Export keeps DefaultDivisions.
export const PreviewDivisions = 6;

// Points that duplicate their predecessor, or whose perpendicular distance from
// the line through their neighbours is below this, are removed from every loop
// before triangulation. This keeps the caps (triangulated by libtess) and the
// walls (built straight from the loop points) agreeing on the boundary, drops
// near-degenerate slivers that would otherwise leave the mesh non-manifold, and
// reduces the triangle count on straight runs. Units are mm; the threshold is
// far below any visible feature but well above float32 noise.
const RedundantPointEpsilon = 1e-3;

export type SymbolOrientation = Pick<FaceParams, 'offset' | 'rotation' | 'scale'>;

export enum Part {
	Front = 'front', // main face of the dice with a hole for the symbol
	Walls = 'walls', // the engraved walls
	Engraved = 'engraved', // the back of the symbol
	Symbol = 'symbol' // a hidden part used to show how the symbol "doesn't fit"
}

export function engrave(
	surface: Shape,
	symbols: Array<Shape>,
	orientation: SymbolOrientation,
	depth: number,
	clearance: number = 0.5, // minimum distance from symbol to edge.
	divisions: number = DefaultDivisions,
	// whether `surface` is convex. true (the default) uses the fast convex-only
	// containment test; pass false for a possibly-concave surface (e.g. a custom
	// coin outline) so the "does the symbol fit?" test uses the general
	// point-in-polygon maths instead of wrongly rejecting a symbol that fits.
	convex: boolean = true
): Array<BufferGeometry> {
	// orient the symbol
	// order is always "scale", "rotate", "translate"
	// shapes are assumed to be centered when they get here.
	if (orientation.scale && orientation.scale !== 1) {
		//console.log('scale', orientation.scale);
		symbols = scaleShapes(orientation.scale, ...symbols);
	}
	if (orientation.rotation) {
		//console.log('rotate', orientation.rotation);
		// the truth test excludes 0 rotation.
		symbols = rotateShapes(orientation.rotation, ...symbols);
	}
	if (orientation.offset && orientation.offset.lengthSq() !== 0) {
		//console.log('offset', orientation.offset);
		symbols = translateShapes(orientation.offset, ...symbols);
	}

	// Replace each symbol with an equivalent polygon shape whose duplicate and
	// collinear points have been removed. From here on every consumer (the front
	// cap holes, the back cap and the walls) derives its points from these same
	// cleaned loops, so they all agree on the boundary edges and earcut has no
	// collinear points left to silently drop -> the engraving stays manifold.
	symbols = symbols.flatMap((s) => cleanShape(s, divisions, RedundantPointEpsilon));

	const canEngraveSymbol = isContained(surface, symbols, clearance, convex);

	// add the initial shape to the group.
	const face = surface.clone();
	const faceGroups: Array<Shape> = [];
	const internalPoints = [] as Array<Array<Vector2>>;
	const areas = new WeakMap<Shape, number>();
	areas.set(face, ShapeUtils.area(face.getPoints()));
	symbols.sort((a, z) => {
		const aa = ShapeUtils.area(a.getPoints());
		const az = ShapeUtils.area(z.getPoints());
		return az - aa;
	});
	if (canEngraveSymbol) {
		for (const s of symbols) {
			// for each bit of the shape.
			// the problem is when some bits are contained within others.
			// so it the "reversed shape" (which is the outline)
			// is inside the hole of a previous shape, we cannot simply
			// add it as another "shape", as we don't fill in the holes.

			// the "reversedShape" is a whole in the outer shape.
			const reversedShape = s.getPoints(divisions).slice();
			if (ShapeUtils.isClockWise(reversedShape)) {
				reversedShape.reverse();
			}
			internalPoints.push(reversedShape);

			// the invertedHoles are new Shapes in their own right.
			const invertedHoles = s.getPointsHoles(divisions).map((hole) => {
				const points = hole.slice();
				if (!ShapeUtils.isClockWise(points)) {
					points.reverse();
				}
				internalPoints.push(points);
				const s = new Shape(points);
				areas.set(s, ShapeUtils.area(points));
				return s;
			});

			// now we need to decide, is the "reversedShape" inside another hole?
			// we need to find the "smallest" hole it fits in.
			const inner = faceGroups.find((x) => {
				const res = anyOuterContainsInner(x, s);
				//console.log('checking if', s, 'is contained in', x, 'result:', res);
				return res;
			});
			if (inner) {
				inner.holes.push(new Path(reversedShape));
			} else {
				face.holes.push(new Path(reversedShape));
			}
			faceGroups.push(...invertedHoles);
			faceGroups.sort((a, z) => {
				const aa = areas.get(a) ?? Infinity;
				const az = areas.get(z) ?? Infinity;
				return az - aa;
			});
		}
	}
	faceGroups.push(face);

	const faceFront = shapeGeometry(faceGroups, divisions);
	faceFront.userData = { diceThingPart: Part.Front };

	if (symbols.length === 0) {
		// if no symbols, then faceFront is the whole thing, no engraving at all
		return [faceFront];
	}

	const symbolOutline = shapeGeometry(symbols, divisions);
	symbolOutline.userData = { diceThingPart: Part.Symbol, diceThingSymbolOK: canEngraveSymbol };
	symbolOutline.translate(0, 0, 0.1); // move it forwards so we can see it clearly

	if (!canEngraveSymbol) {
		return [faceFront, symbolOutline];
	}

	// engrave it.
	const faceBack = shapeGeometry(symbols, divisions);
	faceBack.userData = { diceThingPart: Part.Engraved };

	faceBack.translate(0, 0, -depth);

	// the walls as an array of triangles.
	// which is basically an array of vertices in threes.
	const walls = [];
	// for each "loop", we iterate around all the points and take the "next" one
	// to create a rectangle for the wall segment.
	// then we create 2 triangle for that rectangle and add them to the walls array.
	for (const loop of internalPoints) {
		if (loop[0].equals(loop[loop.length - 1])) {
			loop.pop(); // drop duplicate points at start and end.
		}
		for (let i = 0; i < loop.length; i++) {
			const _a = loop[i];
			const _b = loop[(i + 1) % loop.length];
			// these are the X,Y coordinates of the 2 points.
			// we create 4 points by make a z=0 and z=-engravingDepth.
			// the first triangle is 2 vertices at the "top" and on at the bottom.
			// I don't know which way round to make the triangle to make them face directly,
			// so let's pick a direction.
			const a = [_a.x, _a.y, 0];
			const b = [_b.x, _b.y, 0];
			const c = [_b.x, _b.y, -depth];
			const d = [_a.x, _a.y, -depth];
			// looks like that was the correct direction

			walls.push(...a, ...b, ...c);
			walls.push(...c, ...d, ...a);
		}
	}
	const wallGeo = new BufferGeometry();
	wallGeo.setAttribute('position', new BufferAttribute(new Float32Array(walls), 3));
	wallGeo.computeVertexNormals(); // I use mesh normal material, so this is useful
	wallGeo.userData = { diceThingPart: Part.Walls };

	return [wallGeo, faceBack, faceFront];
}

// Returns polygon Shape(s) equivalent to `s` (curves tessellated at `divisions`)
// with duplicate and collinear points removed from the outline and every hole.
// Building a Shape from plain points produces LineCurves, so downstream
// getPoints()/getPointsHoles() calls return exactly these cleaned points
// regardless of the division count passed.
//
// Normally returns a single shape. Two classes of font/SVG defect break the
// agreement between the libtess cap and the extruded walls, tearing the
// engraving open; both are repaired here so the caps and walls see the same
// clean loops:
//
//  - Proper self-intersection (a figure-8 / self-overlapping contour that
//    resolveShapeBoundaries didn't fully resolve): libtess resolves the crossing
//    under the fill rule while the walls would extrude the raw crossing loop. We
//    re-derive the true fill boundary with a nonzero boundary pass (the winding
//    rule fonts fill with) and rebuild clean outer+hole loops.
//
//  - A loop that self-TOUCHES at a vertex (a spur/pinch that returns to an
//    earlier point) or a near-zero-area sliver loop. A self-touching loop makes
//    the vertical wall edge at the touch point shared by four wall quads
//    (non-manifold); a sliver loop's walls have no matching cap (open edges).
//    Neither is a proper crossing, so unionBoundaryLoops leaves them intact. We
//    de-pinch every loop (splitting it at the touch point into sub-loops) and
//    drop the near-degenerate slivers/spurs, which are sub-print-resolution font
//    artifacts carrying no real engraveable surface.
//
// Either repair can split one symbol into several shapes.
function cleanShape(s: Shape, divisions: number, epsilon: number): Array<Shape> {
	const outer = removeRedundantPoints(s.getPoints(divisions), epsilon);
	const holes = s
		.getPointsHoles(divisions)
		.map((hole) => removeRedundantPoints(hole, epsilon))
		.filter((hole) => hole.length >= 3);
	const all = [outer, ...holes];

	const selfIntersects = anyLoopSelfIntersects(all);
	// Fast path: a clean glyph (no crossing, no self-touch, no degenerate loop)
	// keeps the font's outer/hole structure verbatim - unchanged behaviour for
	// the overwhelming majority of glyphs.
	if (
		!selfIntersects &&
		!all.some((loop) => loopSelfTouches(loop)) &&
		!all.some((loop) => isDegenerateLoop(loop, epsilon))
	) {
		const shape = new Shape(outer);
		shape.holes = holes.map((hole) => new Path(hole));
		return [shape];
	}

	let loops = selfIntersects
		? unionBoundaryLoops(all)
				.map((loop) => removeRedundantPoints(loop, epsilon))
				.filter((loop) => loop.length >= 3)
		: all;
	loops = loops
		.flatMap((loop) => depinchLoop(loop))
		.filter((loop) => !isDegenerateLoop(loop, epsilon));
	return loopsToShapes(loops);
}

// Two loop vertices closer than this weld to one vertex in the exported mesh, so
// a loop revisiting a point within this distance is a self-touch (pinch) that
// would make its wall edge there non-manifold. Matches the mesh weld tolerance.
const SelfTouchTolerance = 1e-4;

// True if a loop revisits any earlier (non-adjacent) vertex within the weld
// tolerance - i.e. it touches itself at a point (a spur/pinch).
function loopSelfTouches(loop: Array<Vector2>): boolean {
	const n = loop.length;
	const tol2 = SelfTouchTolerance * SelfTouchTolerance;
	for (let i = 0; i < n; i++) {
		for (let j = i + 2; j < n; j++) {
			if (i === 0 && j === n - 1) {
				continue; // shared wrap-around vertex
			}
			if (loop[i].distanceToSquared(loop[j]) <= tol2) {
				return true;
			}
		}
	}
	return false;
}

// Split a loop that touches itself at a vertex into independent simple loops.
// When vertex i and vertex j (i<j) are the same point, [i..j-1] closes into one
// sub-loop and the remainder ([0..i-1] + [j..n-1]) closes into another, each
// using the touch point exactly once. Recurses so a loop with several pinches
// (or a point revisited 3+ times) is fully separated. A clean loop is returned
// unchanged.
function depinchLoop(loop: Array<Vector2>): Array<Array<Vector2>> {
	const n = loop.length;
	if (n < 3) {
		return [loop];
	}
	const tol2 = SelfTouchTolerance * SelfTouchTolerance;
	for (let i = 0; i < n; i++) {
		for (let j = i + 2; j < n; j++) {
			if (i === 0 && j === n - 1) {
				continue;
			}
			if (loop[i].distanceToSquared(loop[j]) <= tol2) {
				const inner = loop.slice(i, j);
				const rest = [...loop.slice(0, i), ...loop.slice(j)];
				return [...depinchLoop(inner), ...depinchLoop(rest)];
			}
		}
	}
	return [loop];
}

// A loop with no real engraveable surface: it collapses to fewer than three
// points, or it is a sub-print-resolution sliver/spur whose walls have no
// matching cap. Judged scale-awarely by area and by perpendicular thickness
// (2*area/perimeter, the width of a thin sliver), so both a tiny tab (small
// area) and a long hair-thin sliver (tiny thickness) are caught. These are font
// artifacts (~10um spurs / near-zero-area holes) far below any real feature.
const DegenerateLoopArea = 1e-3; // mm^2
function isDegenerateLoop(loop: Array<Vector2>, epsilon: number): boolean {
	if (loop.length < 3) {
		return true;
	}
	const area = Math.abs(ShapeUtils.area(loop));
	if (area < DegenerateLoopArea) {
		return true;
	}
	let perimeter = 0;
	for (let i = 0; i < loop.length; i++) {
		perimeter += loop[i].distanceTo(loop[(i + 1) % loop.length]);
	}
	return perimeter > 0 && (2 * area) / perimeter < epsilon;
}

// Group a flat set of boundary loops into Shapes by containment nesting: a loop
// at even depth (outside, or inside a hole) is a filled outer; an odd-depth loop
// is a hole of the nearest enclosing outer.
function loopsToShapes(loops: Array<Array<Vector2>>): Array<Shape> {
	const depth = loops.map((loop) => {
		const p = loop[0];
		let d = 0;
		for (const other of loops) {
			if (other !== loop && pointInPolygon(p, other)) {
				d++;
			}
		}
		return d;
	});
	const shapes: Array<Shape> = [];
	for (let i = 0; i < loops.length; i++) {
		if (depth[i] % 2 !== 0) {
			continue; // a hole, attached below
		}
		const shape = new Shape(loops[i]);
		for (let j = 0; j < loops.length; j++) {
			// a hole belongs to this outer when it is one nesting level deeper and
			// sits inside it.
			if (depth[j] === depth[i] + 1 && pointInPolygon(loops[j][0], loops[i])) {
				shape.holes.push(new Path(loops[j]));
			}
		}
		shapes.push(shape);
	}
	return shapes;
}

// Standard even-odd ray-cast point-in-polygon test.
function pointInPolygon(p: Vector2, poly: Array<Vector2>): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
			inside = !inside;
		}
	}
	return inside;
}

// True if any loop has two non-adjacent edges that properly cross, or two loops
// cross each other. Proper crossings only (shared endpoints / touching vertices
// don't count), which is the self-overlap that breaks the cap/wall agreement.
function anyLoopSelfIntersects(loops: Array<Array<Vector2>>): boolean {
	for (let li = 0; li < loops.length; li++) {
		const a = loops[li];
		const n = a.length;
		for (let i = 0; i < n; i++) {
			const a1 = a[i];
			const a2 = a[(i + 1) % n];
			// other edges of the same loop, skipping the two adjacent ones.
			for (let k = i + 2; k < n; k++) {
				if (i === 0 && k === n - 1) {
					continue; // edges sharing the wrap-around vertex
				}
				if (segmentsCross(a1, a2, a[k], a[(k + 1) % n])) {
					return true;
				}
			}
			// edges of later loops.
			for (let lj = li + 1; lj < loops.length; lj++) {
				const b = loops[lj];
				for (let k = 0; k < b.length; k++) {
					if (segmentsCross(a1, a2, b[k], b[(k + 1) % b.length])) {
						return true;
					}
				}
			}
		}
	}
	return false;
}

// Orientation of the triplet (a, b, c): >0 ccw, <0 cw, 0 collinear.
function orient(a: Vector2, b: Vector2, c: Vector2): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// True when segment p1-p2 properly crosses p3-p4 (interiors intersect).
function segmentsCross(p1: Vector2, p2: Vector2, p3: Vector2, p4: Vector2): boolean {
	const d1 = orient(p3, p4, p1);
	const d2 = orient(p3, p4, p2);
	const d3 = orient(p1, p2, p3);
	const d4 = orient(p1, p2, p4);
	return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

// Removes a trailing point coincident with the first, then iteratively removes
// any point that is a duplicate of its predecessor or lies (within epsilon) on
// the line between its two neighbours. Neighbours are read from the live array
// each step so removals compound correctly. The loop keeps at least 3 points.
export function removeRedundantPoints(
	input: Array<Vector2>,
	epsilon: number = RedundantPointEpsilon
): Array<Vector2> {
	const pts = input.slice();
	if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) {
		pts.pop();
	}
	let changed = true;
	while (changed && pts.length > 3) {
		changed = false;
		for (let i = 0; i < pts.length && pts.length > 3; i++) {
			const a = pts[(i - 1 + pts.length) % pts.length];
			const b = pts[i];
			const c = pts[(i + 1) % pts.length];
			if (isRedundantPoint(a, b, c, epsilon)) {
				pts.splice(i, 1);
				i--;
				changed = true;
			}
		}
	}
	return pts;
}

// True if `b` is a duplicate of `a`, or sits on (within epsilon of) segment a->c.
function isRedundantPoint(a: Vector2, b: Vector2, c: Vector2, epsilon: number): boolean {
	if (b.distanceToSquared(a) <= epsilon * epsilon) {
		return true;
	}
	const acx = c.x - a.x;
	const acy = c.y - a.y;
	const acLen = Math.sqrt(acx * acx + acy * acy);
	if (acLen <= epsilon) {
		// a and c are coincident, so the only way b is between them is if it is
		// also coincident, which the duplicate test above already handled.
		return false;
	}
	const cross = (b.x - a.x) * acy - (b.y - a.y) * acx;
	return Math.abs(cross) / acLen < epsilon;
}
