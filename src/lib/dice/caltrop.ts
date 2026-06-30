// The "classic" D4 shape (a tetrahedron) in three styles.
//
// it is modelled as having 12 faces (4 real triangles x 3 segments) for the two
// segmented styles, because that is easier with my render pattern. The "custom"
// style only has 4 faces (each one is a whole triangle).
//
// Styles:
//  - kite:   each equilateral triangle is split into three "kite" segments that
//            meet at the centroid and point at the three vertices. The rolled
//            number reads at the top (the upward vertex).
//  - base:   each equilateral triangle is trisected straight from the vertices to
//            the centroid, giving three triangular segments that point at the
//            three edges. The rolled number reads around the base (the downward
//            edges) instead of the apex.
//  - custom: four faces, each one a whole triangle, for completely custom D4
//            faces.

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Transform, previewTilt } from '$lib/utils/3d';
import { pickForNumber } from '$lib/utils/legends';
import { centerShapes, getBoundingBox, rotateShapes } from '$lib/utils/shapes';
import { Shape, Vector2, Vector3 } from 'three';

const defaultCaltropHeight = 16;

const caltropParameters: Array<DiceParameter> = [
	{
		id: 'caltrop_height',
		defaultValue: defaultCaltropHeight,
		min: 6,
		max: 60,
		step: 0.05
	}
];

const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const numbering = [0, 3, 3, 3, 2, 2, 0, 1, 1, 0, 1, 2];

// 120 degrees between the three segments that make up one real face.
const SEGMENT_STEP = (2 * Math.PI) / 3;

// in-plane angle of segment n within an assembled triangle.
function segmentAngle(n: number): number {
	return n === 0 ? 0 : n === 1 ? SEGMENT_STEP : -SEGMENT_STEP;
}

// For the exploded view the 12 segments are regrouped into their 4 real
// triangular faces (face = i % 4, segment = i % 3). We then pick which face goes
// in each cell (left -> right) and how much to rotate it so the numbers read
// 1,2,3,4. Computed from `numbering` so it follows any renumbering.
const caltropExplodeLayout = computeCaltropExplodeLayout();

function computeCaltropExplodeLayout(): { cellForFace: number[]; triRotForFace: number[] } {
	// for each physical face, map the number it carries -> the segment index n.
	const faceMaps: Array<Record<number, number>> = [];
	for (let f = 0; f < 4; f++) {
		const map: Record<number, number> = {};
		for (const k of [f, f + 4, f + 8]) {
			map[numbering[k]] = k % 3;
		}
		faceMaps.push(map);
	}

	const cellForFace = [0, 1, 2, 3];
	const triRotForFace = [0, 0, 0, 0];
	const usedFace = [false, false, false, false];
	const faceForCell: Array<number> = new Array(4).fill(-1);

	// assign a distinct face to each cell c such that the face carries number c.
	const solve = (c: number): boolean => {
		if (c === 4) return true;
		for (let f = 0; f < 4; f++) {
			if (!usedFace[f] && faceMaps[f][c] !== undefined) {
				usedFace[f] = true;
				faceForCell[c] = f;
				if (solve(c + 1)) return true;
				usedFace[f] = false;
				faceForCell[c] = -1;
			}
		}
		return false;
	};

	if (solve(0)) {
		for (let c = 0; c < 4; c++) {
			const f = faceForCell[c];
			cellForFace[f] = c;
			// rotate the whole triangle so the segment carrying number c sits at its
			// readable (n === 0) position.
			triRotForFace[f] = -segmentAngle(faceMaps[f][c]);
		}
	}

	return { cellForFace, triRotForFace };
}

// tetrahedron math: https://www.mathematische-basteleien.de/tetrahedron.htm
//
// the height of the tetrahedron H is the parameter. From it we derive the edge
// length e and the equilateral triangle height h.
function tetrahedronDimensions(H: number): { e: number; h: number } {
	const e = (3 * H) / Math.sqrt(6);
	const h = (e * Math.sqrt(3)) / 2;
	return { e, h };
}

// center a face/segment shape (so legends sit at its center) and return the
// in-plane y translation needed to re-seat the equilateral centroid back onto
// the origin. All shapes here are defined with the centroid at the origin, so
// the offset is simply the bounding-box center the centering removed.
function seatShape(local: Shape): { shape: Shape; radialOffset: number } {
	const box = getBoundingBox(local);
	const radialOffset = (box.min.y + box.max.y) / 2;
	const [shape] = centerShapes(local);
	return { shape, radialOffset };
}

// fold a triangle that is laid out in "triangle-local" coordinates (centroid on
// the origin, apex pointing up, lying in the z = 0 plane) onto physical face f of
// the tetrahedron. This is identical for every style, so the only thing a style
// changes is the 2D shape of each segment and where it is seated in the face.
function placeOnFace(transform: Transform, f: number, h: number, H: number): void {
	const offsetAngle = Math.asin(1 / 3);
	const mvSlope = () => {
		transform.translateBy(0, (-2 * h) / 3, 0);
		transform.rotateByAxisAngle(xAxis, -offsetAngle);
		transform.translateBy(0, H, 0);
	};

	switch (f) {
		case 0:
			// forward face.
			mvSlope();
			break;
		case 1:
			// left face.
			mvSlope();
			transform.rotateByAxisAngle(yAxis, -SEGMENT_STEP);
			break;
		case 2:
			// right face.
			mvSlope();
			transform.rotateByAxisAngle(yAxis, SEGMENT_STEP);
			break;
		case 3:
			// bottom face.
			transform.rotateByAxisAngle(xAxis, Math.PI / 2);
			transform.rotateByAxisAngle(yAxis, Math.PI);
			break;
	}
	transform.translateBy(0, -H / 3, 0);
}

// build the centered segment shape for the segmented styles. Both define a
// single segment in triangle-local coordinates; the three segments per face are
// just rotated copies of it (see segmentAngle).
function segmentShape(style: 'kite' | 'base', e: number, h: number): Shape {
	if (style === 'kite') {
		// kite for the top vertex: apex -> mid of each adjacent edge -> centroid.
		// it points up, toward the vertex.
		return new Shape([
			new Vector2(0, (2 * h) / 3), // apex (top vertex)
			new Vector2(-e / 4, h / 6), // mid of left edge
			new Vector2(0, 0), // centroid
			new Vector2(e / 4, h / 6) // mid of right edge
		]);
	}
	// base: triangle from the bottom edge to the centroid. it points down, toward
	// the edge, so the number reads along the base.
	return new Shape([
		new Vector2(0, 0), // centroid
		new Vector2(-e / 2, -h / 3), // bottom-left vertex
		new Vector2(e / 2, -h / 3) // bottom-right vertex
	]);
}

function buildSegmented(H: number, style: 'kite' | 'base') {
	const { e, h } = tetrahedronDimensions(H);
	const { shape, radialOffset } = seatShape(segmentShape(style, e, h));

	const faces: Array<DieFaceModel> = Array.from({ length: 12 }).map((_, i) => {
		const n = i % 3; // the segment of this face.
		const f = i % 4; // the face this segment goes on.
		const transform = new Transform()
			.translateBy(0, radialOffset, 0)
			.rotateByAxisAngle(zAxis, segmentAngle(n));
		placeOnFace(transform, f, h, H);

		return {
			isNumberFace: true,
			defaultLegend: pickForNumber(numbering[i], 4),
			shape,
			transform
		};
	});

	// reassemble each real triangular face back into a full equilateral triangle
	// and lay the 4 triangles in a row. each triangle is additionally
	// rotated/reordered so the numbers read 1,2,3,4 left to right (see
	// caltropExplodeLayout).
	const gap = 2;
	const cellW = e + gap;
	const startX = -((4 - 1) * cellW) / 2;
	faces.forEach((face, i) => {
		const n = i % 3;
		const f = i % 4;
		const c = caltropExplodeLayout.cellForFace[f];
		const angle = segmentAngle(n) + caltropExplodeLayout.triRotForFace[f];
		face.explodeTransform = new Transform()
			.translateBy(0, radialOffset, 0)
			.rotateByAxisAngle(zAxis, angle)
			.translate(new Vector3(startX + c * cellW, 0, 0));
	});

	return {
		faces,
		faceToFaceDistance: H
	};
}

function buildCustom(H: number) {
	const { e, h } = tetrahedronDimensions(H);
	// the whole equilateral triangle, centroid at the origin, apex up. The legend
	// is engraved at the shape's local origin, so we deliberately keep the
	// centroid (the triangle's visual centre) there rather than bbox-centering:
	// an equilateral triangle's bbox centre sits h/6 above the centroid, which
	// would raise the legend toward the apex. placeOnFace already expects the
	// centroid on the origin, so no re-seating offset is needed.
	const shape = equilateralTriangleShape(e, h);

	const faces: Array<DieFaceModel> = Array.from({ length: 4 }).map((_, f) => {
		const transform = new Transform();
		// depending on the face we want a pre-rotation.
		switch(f) {
			case 0: // 1 face
				break;// leave this as baseline..
			case 1: // 2 face
				transform.rotateByAxisAngle(zAxis, SEGMENT_STEP);
				break;
			case 2: // 3 face
				transform.rotateByAxisAngle(zAxis, SEGMENT_STEP);
				break;
			case 3: // 4 face
				transform.rotateByAxisAngle(zAxis, -SEGMENT_STEP);
				break;
		}
		placeOnFace(transform, f, h, H);
		return {
			isNumberFace: true,
			defaultLegend: pickForNumber(f, 4), // Legend.BLANK, // yes, blank - on a number face. It is supposed to be custom.
			shape,
			transform
		};
	});

	// flat layout: a simple row of the four triangles, each centered in its cell.
	const gap = 2;
	const cellW = e + gap;
	const startX = -((4 - 1) * cellW) / 2;
	faces.forEach((face, f) => {
		face.explodeTransform = new Transform().translate(new Vector3(startX + f * cellW, 0, 0));
	});

	return {
		faces,
		faceToFaceDistance: H
	};
}

// the whole equilateral triangle for a face, centroid at the origin, apex up.
// (the centroid of these three vertices is already (0, 0).)
function equilateralTriangleShape(e: number, h: number): Shape {
	return new Shape([
		new Vector2(0, (2 * h) / 3), // apex
		new Vector2(-e / 2, -h / 3), // bottom-left
		new Vector2(e / 2, -h / 3) // bottom-right
	]);
}

function caltropModel(id: string, name: string, style: 'kite' | 'base' | 'custom'): DieModel {
	return {
		id,
		name,
		parameters: caltropParameters,
		build(params) {
			const H = params.caltrop_height ?? defaultCaltropHeight;
			const built = style === 'custom' ? buildCustom(H) : buildSegmented(H, style);
			// a tetrahedron viewed straight at one face is just a flat triangle, so
			// tilt the preview to show the pointed 3D form.
			return { ...built, previewTransform: previewTilt() };
		},
		// every caltrop face is a whole equilateral triangle, but the segmented
		// styles model it as three separate faces, so the per-face shape is only a
		// third of the real face. The platform base must be the full triangle.
		platformShape(params) {
			const H = params.caltrop_height ?? defaultCaltropHeight;
			const { e, h } = tetrahedronDimensions(H);
			return equilateralTriangleShape(e, h);
		}
	};
}

// the classic caltrop: numbers read at the top vertex.
export const CaltropD4: DieModel = caltropModel('d4_caltrop', 'D4 Caltrop', 'kite');

// numbers read around the base (vertices-to-centroid trisection).
export const CaltropBaseD4: DieModel = caltropModel('d4_caltrop_base', 'D4 Caltrop Base', 'base');

// four whole-triangle faces for completely custom D4 faces.
export const CaltropCustomD4: DieModel = caltropModel(
	'd4_caltrop_custom',
	'D4 Caltrop Custom',
	'custom'
);
