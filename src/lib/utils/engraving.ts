import {
	BufferAttribute,
	BufferGeometry,
	EdgesGeometry,
	Path,
	Shape,
	ShapeGeometry,
	ShapeUtils,
	Vector2
} from 'three';
import {
	anyOuterContainsInner,
	isContained,
	rotateShapes,
	scaleShapes,
	translateShapes
} from './shapes';
import type { FaceParams } from '$lib/interfaces/dice';

export const DefaultDivisions = 12;

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
	divisions: number = DefaultDivisions
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

	const canEngraveSymbol = isContained(surface, symbols);

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

	const faceFront = new ShapeGeometry(faceGroups, divisions);
	faceFront.userData = { diceThingPart: Part.Front };

	if (symbols.length === 0) {
		// if no symbols, then faceFront is the whole thing, no engraving at all
		return [faceFront];
	}

	const symbolOutline = new ShapeGeometry(symbols, divisions);
	symbolOutline.userData = { diceThingPart: Part.Symbol, diceThingSymbolOK: canEngraveSymbol };
	symbolOutline.translate(0, 0, 0.1); // move it forwards so we can see it clearly

	if (!canEngraveSymbol) {
		return [faceFront, symbolOutline];
	}

	// engrave it.
	const faceBack = new ShapeGeometry(symbols, divisions);
	faceBack.userData = { diceThingPart: Part.Engraved };

	faceBack.translate(0, 0, -depth);

	// the walls as an array of triangles.
	// which is basically an array of vertices in threes.
	const walls = [];
	// for each "loop", we iterate around all the points and take the "next" one
	// to create a rectangle for the wall segment.
	// then we create 2 triangle for that rectangle and add them to the walls array.
	for (let loop of internalPoints) {
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
