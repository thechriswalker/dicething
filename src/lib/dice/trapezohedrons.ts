// these are the dipyramids, like a d10
// but they also include the "rhombic" D6

import type { DiceParameter, DieModel } from '$lib/interfaces/dice';
import { pickForDoublesByIndex, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices } from '$lib/utils/shapes';
import { Plane, Ray, Vector3 } from 'three';

// they are constructed by creating a 2 pyramids and inverting one, then intersecting them
// twist depending on the odd/even nature of the number of faces on each half

// basically all we need however is the shape of 1 face.
// we can create that by calculating the plane of one face of the pyramid
// then invert that plane (for the lower half)
// if twisted, duplicate, then rotate each half a face in opposite directions.

// if twisted the bottom 3 points are the intersections of the top plane and
// the bottom two. create 3 rays from the bottom point aligning with the
// left edge, center join and right edge
// find the intersections of those rays with the plane
// to create a quadrilateral

// if not twisted then it is just the intersection of the 2 planes.
// get the left and right edge of the inverted wedge as rays and intersect
// then with the plane for a triangle.

// I definitely want to parameterise this, as the number placement is deterministic,
// and the shapes are all defined by the number of sides on the die.

const defaultTrapezohderonRadius = 16;
const defaultTrapezohderonHeight = 28;

const trapezohedronParameters: Array<DiceParameter> = [
	{
		id: 'radius',
		name: 'Radius',
		description: 'distance from center axis to edge vertex',
		defaultValue: defaultTrapezohderonRadius,
		min: 10,
		max: 60,
		step: 0.05
	},
	{
		id: 'height',
		name: 'Height',
		description: 'distance from tip to tip',
		defaultValue: defaultTrapezohderonHeight,
		min: 10,
		max: 60,
		step: 0.05
	}
];

const yAxis = new Vector3(0, 1, 0);

function trapezohedron(id: string, name: string, sides: number, tens = false): DieModel {
	const halfSides = sides / 2;
	if (!Number.isInteger(halfSides) || halfSides < 3) {
		throw new Error('cannot build trapzehedron with ' + sides + ' sides');
	}
	// odd number of half sides means we need to twist.
	const isTwisted = halfSides % 2 === 1;

	return {
		id,
		name,
		parameters: trapezohedronParameters,
		build(params) {
			const h = (params.height ?? defaultTrapezohderonHeight) / 2;
			const r = params.radius ?? defaultTrapezohderonRadius;

			// the top and bottom vertices are easy
			const top = new Vector3(0, h, 0);
			const bot = new Vector3(0, -h, 0);

			// the angle of each "ray" is
			const tipAngle = Math.atan(r / h);
			// this is the angle looking down for each segment.
			const baseAngle = (2 * Math.PI) / halfSides;

			// if we assume the vector from the top pointing down at tip angle
			const dr = new Vector3(0, -h, r).applyAxisAngle(yAxis, -baseAngle / 2).add(top);
			const dl = new Vector3(0, -h, r).applyAxisAngle(yAxis, baseAngle / 2).add(top);

			const faceVertice3: Array<Vector3> = [];

			// if not twisted, they will be the corners (but offset by the top)
			// if twisted they are just the directions.
			if (isTwisted) {
				// create a plane from the current vertices
				const topPlane = new Plane().setFromCoplanarPoints(top, dr, dl);

				// now we need to make the bottom planes...
				// the middle direction is:
				const mid = new Vector3(0, h, r);
				const left = mid.clone().applyAxisAngle(yAxis, baseAngle).add(bot);
				const right = mid.clone().applyAxisAngle(yAxis, -baseAngle).add(bot);
				mid.add(bot);
				const leftPlane = new Plane().setFromCoplanarPoints(bot, left, mid);
				const rightPlane = new Plane().setFromCoplanarPoints(bot, mid, right);

				// now our three points (clockwise) are:
				// the intersection right bottom plane with the top right ray.
				const rightRay = new Ray(top, dr.clone().sub(top).normalize());
				const rightIntersect = new Vector3();
				rightRay.intersectPlane(rightPlane, rightIntersect);

				// then the middle, which is a ray from the bottom to the mid point, intersecting with the top plane
				const midRay = new Ray(bot, mid.clone().sub(bot).normalize());
				const midIntersect = new Vector3();
				midRay.intersectPlane(topPlane, midIntersect);

				// then the intersection left bottom plane with the top left ray.
				const leftRay = new Ray(top, dl.clone().sub(top).normalize());
				const leftIntersect = new Vector3();
				leftRay.intersectPlane(leftPlane, leftIntersect);

				faceVertice3.push(top, rightIntersect, midIntersect, leftIntersect);
			} else {
				// we have the 3 vertices.
				faceVertice3.push(top, dr, dl);
			}
			const info = orientCoplanarVertices(faceVertice3);

			return {
				faceToFaceDistance: 1,
				faces: Array.from({ length: sides }, (v, i) => {
					return {
						isNumberFace: true,
						defaultLegend: tens ? pickForDoublesByIndex(i) : pickForNumber(i, sides),
						shape: info.shape,
						orient(geo) {
							// now rotate and/or flip.
							// odd numbers on top. in our left/right swatch.
							// even numbers the same but flipped 180 on x
							geo.applyQuaternion(info.quat);
							geo.translate(info.offset.x, info.offset.y, info.offset.z);

							let n = i + 1;
							// some logic around i.
							let even = false;
							if (n % 2 == 0) {
								// even number.
								// they are placed opposite their odd couterpart.
								even = true;
								// using the sides+1 total rule.
								// the number this should be opposite is sides - n+1
								n = sides - n + 1;
							}

							// find odd number position
							// we position the odd numbers evenly
							// here n = 3 => sign = -1, x = 1
							//      n = 5 => sign = 1, x = 1
							//      n = 7 => sign = -1, x = 2
							//      n = 9 => sign = 1, x = 2
							//      n = 11 => sign = -1, x = 3, ...etc
							const u = (n - 1) / 2;
							const sign = 2 * (u % 2) - 1; // is this odd or even, which infers left or right. this is 1 or -1
							// (n-1)/2 1,2,3,4
							//         1,0,1,0
							//         2 2 4 4
							const x = (u + (u % 2)) / 2;

							// 3 is alpha*1,
							// 5 is alpha*1,
							// 7 = 2*alpha,
							// 9 = 2*alpha
							let rotation = sign * baseAngle * x;
							if (even) {
								geo.rotateX(Math.PI); // flip it on x-axis
							}
							geo.rotateY(rotation);
						}
					};
				})
			};
		}
	};
}

export const RhombicD6 = trapezohedron('rhombic_d6', 'Rhombic D6', 6);
export const TrapezohedronD8 = trapezohedron('trapezohedron_d8', 'D8 Trapezohedron', 8);
export const TrapezohedronD10 = trapezohedron('trapezohedron_d10', 'D10 Twisted Trapezohedron', 10);
export const TrapezohedronD00 = trapezohedron(
	'trapezohedron_d00',
	'D% Twisted Trapezohedron',
	10,
	true
);
export const TrapezohedronD12 = trapezohedron('trapezohedron_d12', 'D12 Trapezohedron', 12);
