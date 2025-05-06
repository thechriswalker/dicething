import type { DieModel, DieFaceModel, DiceParameter } from '$lib/interfaces/dice';
import { Legend, pickForDoublesByIndex, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices, rotateShapes } from '$lib/utils/shapes';
import { BufferGeometry, Plane, Ray, Shape, Vector2, Vector3 } from 'three';

const defaultHeight = 16;
const defaultWidth = 8;
const defaultCapHeight = 4;
const defaultCapTwist = 0.5;

const yAxis = new Vector3(0, 1, 0);

const crystalParameters: Array<DiceParameter> = [
	{
		id: 'crystal_height',
		defaultValue: defaultHeight,
		min: 6,
		max: 60,
		step: 1
	},
	{
		id: 'crystal_width',
		defaultValue: defaultWidth,
		min: 6,
		max: 60,
		step: 0.5
	},
	{
		id: 'crystal_cap',
		defaultValue: defaultCapHeight,
		min: 1,
		max: 30,
		step: 0.2
	},
	{
		id: 'crystal_twist',
		defaultValue: defaultCapTwist,
		min: 0,
		max: 0.98,
		step: 0.02
	}
];

export const CrystalD4 = crystal('crystal_d4', 'D4 Crystal', 4);
export const CrystalD6 = crystal('crystal_d6', 'D6 Crystal', 6);
export const CrystalD8 = crystal('crystal_d8', 'D6 Crystal', 8);
export const CrystalD10 = crystal('crystal_d10', 'D10 Crystal', 10);
export const CrystalD12 = crystal('crystal_d12', 'D12 Crystal', 12);
export const CrystalD00 = crystal('crystal_d00', 'D% Crystal', 10, true);

function crystal(id: string, name: string, sides: number, tens = false): DieModel {
	return { id, name, parameters: crystalParameters, build: build(sides, tens) };
}

function build(sides: number, tens: boolean): DieModel['build'] {
	return (params) => {
		const x = params.crystal_width ?? defaultWidth;
		const x2 = x / 2;
		const y = params.crystal_height ?? defaultHeight;
		const y2 = y / 2;
		const rot = params.crystal_twist ?? defaultCapTwist;
		const h = params.crystal_cap ?? defaultCapHeight;
		const isTwisted = rot !== 0;

		// I think I need to construct this in 3-space and then project each face onto the plane +z on the origin.
		// but I only need to construct the cap faces, as the front face is already
		//

		// the number of sides will make a difference, I guess I want to parameterise this in terms of the number of sides...
		//const sides = 4; //  4 nunmber sides, and 4 sides on EACH cap.
		// this is the angle between the faces.
		const alpha = (2 * Math.PI) / sides;
		// this is the angle of rotation if twisted
		const theta = alpha * rot;
		// halfSide / tan( halfAngle ) = distance from edge to center
		const d = x2 / Math.tan(alpha / 2);

		// the base number faces are square if the twist is 0
		// but if not, they have six vertices.
		// but we can inject those extra vertices.
		const numberFaceVertices: Array<Vector2> = [];
		// we only know about 2 of the vertices of the cap faces right now.
		// and we only know about them in 3d... we will add the "top" right now
		// as it is the center of the cap, and always the same.
		const capFaceVertices3 = [
			new Vector3(0, h + y2, 0) // cap at x=0, z=0 y= half height+cap height
		];

		if (isTwisted) {
			// we need to add in the extra points on the number faces, and the
			// blank faces are more complicated (quadrilaterals not triangles.)
			// the point for the regular faces is constructed, by creating an arc
			// of a circle the correct radius going through the 2 corner points.
			// then finding the point on the arc the correct "twist" rotation from
			// in the "alpha" degree arc.
			// Then we find the intersection on the vector and the xy plane.
			// this is easier than it sounds as we know the angle of the line
			// which is from the top to the corner.
			// then we can rotate that vector around y the "twist" and it will be
			// pointing in the right direction at the right angle.
			// then we intersect the line from the plane
			let plane = new Plane(new Vector3(0, 0, -1), d); // -1 because that puts it forwards...?
			const top = new Vector3().copy(capFaceVertices3[0]);
			const _v = new Vector3(-x2, y2, d);
			const direction = _v.clone().sub(top);
			// this rotation is correct, I need to rotate around the yaxis...
			direction.applyAxisAngle(new Vector3(0, 1, 0), theta);
			direction.normalize();
			let ray = new Ray(top, direction);
			const intersection = new Vector3();
			ray.intersectPlane(plane, intersection);
			// console.log({ intersection });
			// now add an "-alpha" rotated version of the intersection
			const intersection2 = new Vector3().copy(intersection).applyAxisAngle(yAxis, -alpha);

			// the "actual" corner needs to be on the plane of the triangle though (so may not be)
			// cap is already in the array, so we add the insection point and then the corner.
			// so I will do another ray intersection.
			// this time pointing up along the corner (-x2, d)
			ray = new Ray(new Vector3(-x2, 0, d), new Vector3(0, 1, 0));
			plane = new Plane().setFromCoplanarPoints(intersection, top, intersection2);
			const corner = new Vector3();
			ray.intersectPlane(plane, corner);
			// console.log({ ray, corner, plane });

			capFaceVertices3.push(intersection2, corner, intersection);

			// now the 2 points in 2D space for the intersections for the front face.
			const p = new Vector2(intersection.x, intersection.y);
			const pivot = new Vector2(0, 0);
			const q = p.clone().rotateAround(pivot, Math.PI);
			// and the corners are not quite as high.
			const cornerHeight = corner.y;
			numberFaceVertices.push(
				new Vector2(-x2, cornerHeight),
				p,
				new Vector2(x2, cornerHeight),
				new Vector2(x2, -cornerHeight),
				q,
				new Vector2(-x2, -cornerHeight)
			);
		} else {
			// cap face is a triangle, just add the right, then left point, pushed out
			// to d.
			capFaceVertices3.push(new Vector3(-x2, y2, d), new Vector3(x2, y2, d));
			// and the number faces are full height:
			numberFaceVertices.push(
				new Vector2(-x2, y2),
				new Vector2(x2, y2),
				new Vector2(x2, -y2),
				new Vector2(-x2, -y2)
			);
		}

		const capFaceInfo = orientCoplanarVertices(capFaceVertices3);
		//const points = capFaceInfo.shape.getPoints();
		let face = new Shape(numberFaceVertices);
		if (tens) {
			// if a "tens" dice, rotate the numbers 90deg by default
			[face] = rotateShapes(Math.PI / 2, face);
		}
		const yRotation = (i: number, obj: BufferGeometry) => {
			// rotate based on index.
			if (i == 0) {
				return;
			}
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
			let rotation = sign * alpha * x;
			// if we are actually even rotate an extra 180
			if (even) {
				rotation += sign * Math.PI;
			}

			obj.rotateY(rotation);
		};

		// the number faces, in numerical order.
		const faces: Array<DieFaceModel> = Array.from({ length: sides }).map((_, i) => {
			return {
				isNumberFace: true,
				shape: face,
				defaultLegend: tens ? pickForDoublesByIndex(i) : pickForNumber(i, sides),
				orient(geo) {
					if (tens) {
						geo.rotateZ(-Math.PI / 2);
					}
					// these need to be pushed out
					geo.translate(0, 0, d);
					yRotation(i, geo);
					// but now potentially rotated around the yAxis basis on the position we want them
				}
			};
		});

		// now we add the cap faces. two for each side, oriented differently
		const capBasicOrient = (obj: BufferGeometry) => {
			// move "start position"
			obj.applyQuaternion(capFaceInfo.quat);
			obj.translate(capFaceInfo.offset.x, capFaceInfo.offset.y, capFaceInfo.offset.z);
		};

		for (let i = 0; i < sides; i++) {
			faces.push(
				{
					isNumberFace: false,
					shape: capFaceInfo.shape,
					defaultLegend: Legend.BLANK,
					// top
					orient(obj) {
						capBasicOrient(obj);
						yRotation(i, obj);
					}
				},
				{
					isNumberFace: false,
					shape: capFaceInfo.shape,
					defaultLegend: Legend.BLANK,
					// top
					orient(obj) {
						capBasicOrient(obj);
						yRotation(i, obj);
						obj.rotateX(Math.PI);
					}
				}
			);
		}

		return {
			legendScaling: 1,
			faceToFaceDistance: d * 2,
			faces
		};
	};
}
