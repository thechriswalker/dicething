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
import { Transform, vectorRotateZ } from './3d';
import { getBoundingBox } from './shapes';

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

const zaxis = new Vector3(0, 0, 1);

export function polyhedron(
	id: string,
	name: string,
	sides: Array<PolyhedronFace>,
	shaper: Shaper,
	parameters: Array<DiceParameter> = defaultParameters(),
	individualLegendScaling?: boolean
): DieModel {
	// might as well only do this once.
	const _q = new Quaternion();
	const quats: Array<Quaternion> = sides.map((s) => {
		let quat: Quaternion = new Quaternion().identity();

		if (s.angle) {
			if (!Array.isArray(s.angle)) {
				_q.setFromAxisAngle(s.axis as Vector3, s.angle);
				quat = quat.multiply(_q);
			} else {
				const ax = s.axis as Array<Vector3>;
				for (let i = 0; i < ax.length; i++) {
					// modify the next axis in realtion to the last...
					_q.setFromAxisAngle(ax[i], s.angle[i]);
					quat = quat.multiply(_q);
				}
			}
		}
		if (s.preRotation) {
			_q.setFromAxisAngle(zaxis, s.preRotation);
			quat = quat.multiply(_q);
		}
		return quat;
	});

	// spacing per side can
	const n = sides.length;
	const x = Math.ceil(Math.sqrt(n));
	const y = Math.ceil(n / x);

	return {
		id,
		name,
		parameters,
		build(params) {
			const d = params.polyhedron_size ?? defaultF2F;
			const face = shaper(d);
			// find the spacing for the explode view
			// basically a vector offset based on the size of the shape.
			const facebox = getBoundingBox(face, 2);
			const steps = facebox.getSize(new Vector2());
			// work out the topleft offset of the grid.
			// its the center offset, so we want to offset a half step as well
			const topleft = new Vector3(
				steps.x / 2 + (-1 * steps.x * x) / 2,
				-steps.y / 2 + (steps.y * y) / 2,
				0
			);

			return {
				legendScaling: 1,
				faceToFaceDistance: d,
				sizeLegendsIndividually: individualLegendScaling,
				faces: sides.map((s, i) => {
					const transform = new Transform().translateBy(0, 0, d / 2).rotate(quats[i]);

					// the explode transform is just an XY change, based on the
					// start at the top left and
					let translation = topleft.clone();
					// add the x stride and y offset
					translation = translation.add(
						new Vector3(steps.x * (i % x), -1 * steps.y * Math.floor(i / (y + 1)))
					);

					const explodeTransform = new Transform().translate(translation);

					return {
						isNumberFace: true, // they all are
						shape: face,
						defaultLegend: pickForNumber(i, sides.length),
						transform,
						explodeTransform
					};
				})
			};
		}
	};
}

// icosahedron similarly complex, but just 8 more faces.
