import {
	BufferAttribute,
	BufferGeometry,
	EdgesGeometry,
	Path,
	Shape,
	ShapeGeometry,
	Vector2
} from 'three';
import { isContained, rotateShapes, scaleShapes, translateShapes } from './shapes';
import type { FaceParams } from '$lib/interfaces/dice';

export const DefaultDivisions = 12;

export type SymbolOrientation = Pick<FaceParams, 'offset' | 'rotation' | 'scale'>;

export enum Part {
	Front = 'front',
	Walls = 'walls',
	Engraved = 'engraved',
	FaceOutline = 'face_outline',
	SymbolOutline = 'symbol_outline'
}

export function isOutline(p: Part) {
	return p === Part.FaceOutline || p === Part.SymbolOutline;
}

const outlineOffset = 0.01;

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

	if (!isContained(surface, symbols)) {
		throw new Error('symbols out of bounds');
	}

	// face outline is BEFORE we engrave.
	const faceOutline = new EdgesGeometry(new ShapeGeometry(surface));
	faceOutline.userData = { diceThingPart: Part.FaceOutline };
	faceOutline.translate(0, 0, outlineOffset);

	// add the initial shape to the group.
	const face = surface.clone();
	const faceGroups = [face];
	const internalPoints = [] as Array<Array<Vector2>>;

	for (const s of symbols) {
		const reversedShape = s.getPoints(divisions).slice().reverse();
		internalPoints.push(reversedShape);
		const invertedHoles = s.getPointsHoles(divisions).map((hole) => {
			const points = hole.slice().reverse();
			internalPoints.push(points);
			return new Shape(points);
		});
		face.holes.push(new Path(reversedShape));
		faceGroups.push(...invertedHoles);
	}

	const faceFront = new ShapeGeometry(faceGroups, divisions);
	faceFront.userData = { diceThingPart: Part.Front };

	if (symbols.length === 0) {
		// if no symbols, then faceFront is the whole thing.
		// we return the outline as well.
		return [faceFront, faceOutline];
	}

	const faceBack = new ShapeGeometry(symbols, divisions);
	faceBack.userData = { diceThingPart: Part.Engraved };

	const symbolOutline = new EdgesGeometry(faceBack); // before we move it!
	symbolOutline.userData = { diceThingPart: Part.SymbolOutline };
	// translate the outline slightly, to ensure visibility
	symbolOutline.translate(0, 0, outlineOffset);

	// engrave it.
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

	return [wallGeo, faceBack, faceFront, faceOutline, symbolOutline];
}
