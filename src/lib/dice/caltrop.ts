// I dislike this D4, but it is the "classic" shape.
// it is modelled as having 12 faces, because that is easier with my render pattern.
// That might make it more difficult to customise, but I don't care...

import type { DiceParameter, DieModel } from '$lib/interfaces/dice';
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
		return {
			faces: Array.from({ length: 12 }).map((_, i) => {
				const n = i % 3; // the "segment" of this face.
				const f = i % 4; // the face to put this segment on
				const transform = new Transform()
					.translateBy(0, h / 3, 0)
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
					transform,
				};
			}),
			faceToFaceDistance: H
		};
	}
};
