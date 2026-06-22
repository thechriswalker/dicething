// I dislike this D4, but it is the "classic" shape.
// it is modelled as having 12 faces, because that is easier with my render pattern.
// That might make it more difficult to customise, but I don't care...

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Transform, vectorRotateX, vectorRotateY, vectorRotateZ } from '$lib/utils/3d';
import { pickForNumber } from '$lib/utils/legends';
import { centerShapes } from '$lib/utils/shapes';
import { Shape, Vector2, Camera, Vector3 } from 'three';

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

const origin = new Vector2(0, 0);
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const numbering = [0, 3, 3, 3, 2, 2, 0, 1, 1, 0, 1, 2];

// 120 degrees between the three kite segments that make up one real face.
const SEGMENT_STEP = (2 * Math.PI) / 3;

// in-plane angle of segment n within an assembled triangle (apex of n=0 is "up").
function segmentAngle(n: number): number {
	return n === 0 ? 0 : n === 1 ? SEGMENT_STEP : -SEGMENT_STEP;
}

// For the exploded view the 12 kite segments are regrouped into their 4 real
// triangular faces (face = i % 4, segment = i % 3). We then pick which face goes
// in each cell (left -> right) and how much to rotate it so the apex numbers read
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
			// rotate the whole triangle so the segment carrying number c sits at the apex.
			triRotForFace[f] = -segmentAngle(faceMaps[f][c]);
		}
	}

	return { cellForFace, triRotForFace };
}

export const CaltropD4: DieModel = {
	id: 'caltrop_d4',
	name: 'D4 Caltrop',
	parameters: caltropParameters,
	build(params) {
		// tetrahedron math: https://www.mathematische-basteleien.de/tetrahedron.htm
		//
		// Height in space H = edgeLength * sqrt(6) / 3

		// The height of an equilateral triangle is: h = sqrt(3) * edgelength / 2

		// so if we want a tetrahedron height H
		// we must work out edge length, then equilateral triangle height.

		// the face is simple, but we still need some math.
		// the height of the tetrahedron is a parameter.
		const H = params.caltrop_height ?? defaultCaltropHeight;

		// // so we can work out the edge length from that.
		const e = (3 * H) / Math.sqrt(6);

		// so triangle height h;
		const h = (e * Math.sqrt(3)) / 2;

		// Now we actually want to create three pieces for each face.
		// they are all similar, so the shape will be the top one.]
		// the "center" of the triangle is one third of the way up from the base.
		// we will center our segment on the z-axis to make it easier.
		const top = new Vector2(0, h);
		const center = new Vector2(0, h / 3);

		// and we need the mid point of the sides.
		// we can work that out by rotating around the z-axis by 60 degrees.
		const sixtyDeg = Math.PI / 3;
		const midRight = center.clone().rotateAround(origin, sixtyDeg).add(center);
		const midLeft = center.clone().rotateAround(origin, -sixtyDeg).add(center);

		let shape = new Shape([top, midRight, center, midLeft]);
		// we need to create three pieces for each face.
		[shape] = centerShapes(shape);

		// now the offset to the center (y axis)
		// in a tetrahedron, this is simply
		const offsetAngle = Math.asin(1 / 3);
		const faces: Array<DieFaceModel> = Array.from({ length: 12 }).map((_, i) => {
				const n = i % 3; // the "segment" of this face.
				const f = i % 4; // the face to put this segment on
				const transform = new Transform().translateBy(0, h / 3, 0);
				switch (n) {
					case 0:
						// no roation
						break;
					case 1:
						transform.rotateByAxisAngle(zAxis, 2 * sixtyDeg);
						break;
					case 2:
						transform.rotateByAxisAngle(zAxis, -2 * sixtyDeg);
						break;
				}
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
						transform.rotateByAxisAngle(yAxis, -2 * sixtyDeg);
						break;
					case 2:
						// right face.
						mvSlope();
						transform.rotateByAxisAngle(yAxis, 2 * sixtyDeg);
						break;
					case 3:
						// bottom face
						transform.rotateByAxisAngle(xAxis, Math.PI / 2);
						//geo.translate(0, -H, 0);
						transform.rotateByAxisAngle(yAxis, Math.PI);
						break;
				}
				transform.translateBy(0, -H / 3, 0);

				return {
					isNumberFace: true,
					defaultLegend: pickForNumber(numbering[i], 4),
					shape: shape,
					transform
				};
			});

		// reassemble each real triangular face back into a full equilateral triangle
		// and lay the 4 triangles in a row. the in-plane assembly is the same one the
		// 3D build uses for the forward face (translate up by h/3 then rotate the
		// segment about the origin), which leaves the triangle centered on the origin.
		// each triangle is additionally rotated/reordered so the apex numbers read
		// 1,2,3,4 left to right (see caltropExplodeLayout).
		const gap = 2;
		const cellW = e + gap;
		const startX = -((4 - 1) * cellW) / 2;
		faces.forEach((face, i) => {
			const n = i % 3; // segment within the face
			const f = i % 4; // which physical face
			const c = caltropExplodeLayout.cellForFace[f];
			const angle = segmentAngle(n) + caltropExplodeLayout.triRotForFace[f];
			face.explodeTransform = new Transform()
				.translateBy(0, h / 3, 0)
				.rotateByAxisAngle(zAxis, angle)
				.translate(new Vector3(startX + c * cellW, 0, 0));
		});

		return {
			faces,
			faceToFaceDistance: H
		};
	}
};
