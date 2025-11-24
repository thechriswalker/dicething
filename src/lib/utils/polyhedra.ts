// maybe I can "abstract" the side count... well, maybe not, but I can describe the
// orientation of the faces for any "regular" polyhedron (all the platonic solids and the
// rhombic dodecahedron).
//
// however we shall omit the octahedron as that is better desceibed as a dipyramid so we can stretch it if
// we want (same as the rhombic D6)
//
// so this file can describe Cube, Dodecahedron, Icosahedron, Rhombic Dodecahedron

import type { DiceParameter, DieModel } from '$lib/interfaces/dice';
import { pickForNumber } from '$lib/utils/legends';
import { Quaternion, Shape, Vector2, Vector3, type BufferGeometry, type Camera } from 'three';
import { vectorRotateZ } from './3d';

const defaultF2F = 18;

export const defaultParameters = (): Array<DiceParameter> => {
	return [
		{
			id: 'polyhedron_size',
			min: 6,
			max: 60,
			step: 0.5,
			defaultValue: defaultF2F
		}
	];
};

// lets see if we can define these by "Shape" (all faces the same)
// and orientation info? That way we can probably use this for a cube
// we will need a function for "face-to-face" distance to "shape" size?
// or maybe a function to generate the "shape" from a face2face distance.
// feels like we should be able to orient faces for regular polyhedrons easily.
// in order to orient and place the faces, we need to know the center and normal
// of each face.

export type PolyhedronFace = {
	axis: Vector3 | Array<Vector3>; // axis of rotation
	angle: number | Array<number>; // angle of rotation
	preRotation?: number; // degrees to rotate in the Z plane before movement (to enable faces to lie in different directions)
};
export type Shaper = (distance: number) => Shape;

export function polyhedron(
	id: string,
	name: string,
	sides: Array<PolyhedronFace>,
	shaper: Shaper,
	parameters: Array<DiceParameter> = defaultParameters()
): DieModel {
	// might as well only do this once.
	const quats: Array<Quaternion | undefined> = sides.map((s) => {
		let quat: Quaternion | undefined = undefined;
		if (s.angle) {
			if (!Array.isArray(s.angle)) {
				quat = new Quaternion().setFromAxisAngle(s.axis as Vector3, s.angle);
			} else {
				const ax = s.axis as Array<Vector3>;
				quat = new Quaternion().setFromAxisAngle(ax[0], s.angle[0]);
				for (let i = 1; i < ax.length; i++) {
					// modify the next axis in realtion to the last...
					const nx = ax[i].clone().applyQuaternion(quat);
					const q = new Quaternion().setFromAxisAngle(ax[i], s.angle[i]);
					quat = quat!.multiply(q);
				}
			}
		}
		return quat;
	});

	return {
		id,
		name,
		parameters,
		build(params) {
			const d = params.polyhedron_size ?? defaultF2F;
			const face = shaper(d);
			return {
				legendScaling: 1,
				faceToFaceDistance: d,
				faces: sides.map((s, i) => {
					const quat = quats[i];
					return {
						isNumberFace: true, // they all are
						shape: face,
						defaultLegend: pickForNumber(i, sides.length),
						orient(geo) {
							// push it out in Z by half the face to face distance
							geo.translate(0, 0, d / 2);
							// do we need to rotate around Z?
							if (s.preRotation) {
								geo.rotateZ(s.preRotation);
							}
							// any other rotation?
							if (quat) {
								geo.applyQuaternion(quat);
							}
						},
						pointCamera(cam: Camera): void {
							if (s.preRotation) {
								vectorRotateZ(cam.position, s.preRotation);
								vectorRotateZ(cam.up, s.preRotation);
								cam.up = cam.up.normalize();
							}
							if (quat) {
								cam.position.applyQuaternion(quat);
								cam.up = cam.up.applyQuaternion(quat).normalize();
							}
						}
					};
				})
			};
		}
	};
}

// icosahedron similarly complex, but just 8 more faces.
