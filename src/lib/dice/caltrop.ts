// I dislike this D4, but it is the "classic" shape.
// it is modelled as having 12 faces, because that is easier with my render pattern.
// That might make it more difficult to customise, but I don't care...

import type { DiceParameter, DieModel } from '$lib/interfaces/dice';
import { vectorRotateX, vectorRotateY, vectorRotateZ } from '$lib/utils/3d';
import { pickForNumber } from '$lib/utils/legends';
import { centerShapes } from '$lib/utils/shapes';
import { Shape, Vector2, Camera } from 'three';

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

const numbering = [0, 3, 3, 3, 2, 2, 0, 1, 1, 0, 1, 2];

export const CaltropD4: DieModel = {
	id: 'caltrop_d4',
	name: 'D4 Caltrop',
	parameters: caltropParameters,
	build(params) {
		// the face is simple, but we still need some math.
		// the height of the tetrahedron is a parameter.
		const H = params.caltrop_height ?? defaultCaltropHeight;

		// so we can work out the edge length from that.
		const e = (3 * H) / Math.sqrt(6);

		// the insphere radius is 1/3 of the height of each equilateral triange
		const inRadius = (e * Math.sqrt(6)) / 12;

		const h = Math.sqrt(3) * e;

		// Now we actually want to create three pieces for each face.
		// they are all similar, so the shape will be the top one.]
		// the "center" of the triangle is one third of the way up from the base.
		// we will center our segment on the z-axis to make it easier.
		const top = new Vector2(0, h);
		const center = new Vector2(0, h / 3);

		console.log({ H, e, inRadius, h });
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
				return {
					isNumberFace: true,
					defaultLegend: pickForNumber(numbering[i], 4),
					shape: shape,
					orient(geo) {
						// in every case we move it up so the "center" point is at the origin.
						// nb height here is the triangle face height, not the tetrahedron height
						geo.translate(0, h / 3, 0);
						// then we rotate it to the correct orientation.
						switch (n) {
							case 0:
								// no roation
								break;
							case 1:
								geo.rotateZ(2 * sixtyDeg);
								break;
							case 2:
								geo.rotateZ(-2 * sixtyDeg);
								break;
						}

						// then we orient the shape to the plane of the triangular face.
						// then we roatate it to each face.
						const mvSlope = () => {
							geo.translate(0, (-2 * h) / 3, 0);
							geo.rotateX(-offsetAngle);
							geo.translate(0, H, 0);
						};
						switch (f) {
							case 0:
								// forward face.
								mvSlope();
								break;
							case 1:
								// left face.
								mvSlope();
								geo.rotateY(-2 * sixtyDeg);
								break;
							case 2:
								// right face.
								mvSlope();
								geo.rotateY(2 * sixtyDeg);
								break;
							case 3:
								// bottom face
								geo.rotateX(Math.PI / 2);
								geo.translate(0, -H, 0);
								geo.rotateY(Math.PI);
								break;
						}
						// pull it up.
						// TBH we shold probably have all dice sitting on the xz plane,
						// so when we render them all together it looks like the are all sat flush.
						geo.translate(0, H / 2, 0);
					},
					pointCamera(cam: Camera) {
						switch (n) {
							case 0:
								// no roation
								break;
							case 1:
								vectorRotateZ(cam.position, 2 * sixtyDeg);
								vectorRotateZ(cam.up, 2 * sixtyDeg);
								break;
							case 2:
								vectorRotateZ(cam.position, -2 * sixtyDeg);
								vectorRotateZ(cam.up, -2 * sixtyDeg);
								break;
						}
						switch (f) {
							case 0:
								// forward face.
								vectorRotateX(cam.position, -offsetAngle);
								vectorRotateX(cam.up, -offsetAngle);
								break;
							case 1:
								// left face.
								vectorRotateX(cam.position, -offsetAngle);
								vectorRotateX(cam.up, -offsetAngle);
								vectorRotateY(cam.position, -2 * sixtyDeg);
								vectorRotateY(cam.up, -2 * sixtyDeg);
								break;
							case 2:
								// right face.
								vectorRotateX(cam.position, -offsetAngle);
								vectorRotateX(cam.up, -offsetAngle);
								vectorRotateY(cam.position, 2 * sixtyDeg);
								vectorRotateY(cam.up, 2 * sixtyDeg);
							case 3:
								// bottom face
								vectorRotateX(cam.position, Math.PI / 2);
								vectorRotateX(cam.up, Math.PI / 2);
								vectorRotateY(cam.position, Math.PI);
								vectorRotateY(cam.up, Math.PI);
								break;
						}
						cam.up = cam.up.normalize();
					}
				};
			}),
			faceToFaceDistance: H
		};
	}
};
