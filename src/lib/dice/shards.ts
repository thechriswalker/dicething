// shards are basically trapezohedrons with
// unbalanced lengths.
// i.e. long edge for number faces and short cap for blanks.
import type { DieModel, DieFaceModel, DiceParameter } from '$lib/interfaces/dice';
import { Transform, vectorRotateY, vectorRotateZ } from '$lib/utils/3d';
import { Legend, pickForDoublesByIndex, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices, rotateShapes, translateShapes } from '$lib/utils/shapes';
import { BufferGeometry, Plane, Ray, Camera, Vector2, Vector3 } from 'three';

const defaultHeight = 24;
const defaultRadius = 8;
const defaultCapHeight = 4;
const defaultCapTwist = 0.2;

const yAxis = new Vector3(0, 1, 0);

const shardParameters: Array<DiceParameter> = [
	{
		id: 'shard_height',
		defaultValue: defaultHeight,
		min: 6,
		max: 60,
		step: 1
	},
	{
		id: 'shard_radius',
		defaultValue: defaultRadius,
		min: 6,
		max: 60,
		step: 0.5
	},
	{
		id: 'shard_cap',

		defaultValue: defaultCapHeight,
		min: 1,
		max: 30,
		step: 0.2
	},
	{
		id: 'shard_twist',
		defaultValue: defaultCapTwist,
		min: 0,
		max: 0.98,
		step: 0.02
	}
];

export const ShardD4 = shard('shard_d4', 'D4 Shard', 4);
export const ShardD6 = shard('shard_d6', 'D6 Shard', 6);
export const ShardD8 = shard('shard_d8', 'D6 Shard', 8);
export const ShardD10 = shard('shard_d10', 'D10 Shard', 10);
export const ShardD12 = shard('shard_d12', 'D12 Shard', 12);
export const ShardD00 = shard('shard_d00', 'D% Shard', 10, true);

function shard(id: string, name: string, sides: number, tens = false): DieModel {
	return { id, name, parameters: shardParameters, build: build(sides, tens) };
}

const zAxis = new Vector3(0, 0, 1);

function build(sides: number, tens: boolean): DieModel['build'] {
	return (params) => {
		const r = params.shard_radius ?? defaultRadius;
		const y = params.shard_height ?? defaultHeight;
		const rot = params.shard_twist ?? defaultCapTwist;
		const h = params.shard_cap ?? defaultCapHeight;
		const isTwisted = rot !== 0;

		// I think I need to construct this in 3-space and then project each face onto the plane +z on the origin.
		// but I only need to construct the cap faces, as the front face is already
		//

		// the number of sides will make a difference, I guess I want to parameterise this in terms of the number of sides...
		// this is the angle between the faces.
		const alpha = (2 * Math.PI) / sides;
		// this is the angle of rotation if twisted
		const theta = alpha * rot;

		// this is the distance from the y-axis to the face edge and y = 0 (the inradius)
		const d = r * Math.cos(alpha / 2);
		const w2 = r * Math.sin(alpha / 2);

		// the base number faces are triangular if the twist is 0
		// but they are now sloped, so we need to construct aVector3.
		const numberFaceVertices3: Array<Vector3> = [];
		const bottom = new Vector3(0, -y, 0);

		// we only know about 2 of the vertices of the cap faces right now.
		// and we only know about them in 3d... we will add the "top" right now
		// as it is the center of the cap, and always the same.
		const capFaceVertices3: Array<Vector3> = [];
		const top = new Vector3(0, h, 0);

		// this point is useful in either case, it is where the no twist version would
		// have a vertex, but it is always the right direction for the rays.
		const left = new Vector3(-w2, 0, d);
		const right = new Vector3(w2, 0, d);

		if (isTwisted) {
			// in the twisted case we have 2 cap planes (a left and right)
			// and we need to intersect those with rays from the bottom up.
			// then we interset a ray from the top down the edge of the cap plane with the bottom plane.
			const bottomPlane = new Plane().setFromCoplanarPoints(bottom, left, right);

			const bottomRightRay = new Ray(bottom, right.clone().sub(bottom).normalize());

			const topMid = right.clone().applyAxisAngle(yAxis, -theta);
			const topMid2 = topMid.clone().applyAxisAngle(yAxis, alpha);

			const topRightPlane = new Plane().setFromCoplanarPoints(top, topMid, topMid2);
			const topMidRay = new Ray(top, topMid.clone().sub(top).normalize());

			// the twist peak
			const faceMid = new Vector3();
			topMidRay.intersectPlane(bottomPlane, faceMid);

			// the right corner
			const faceRight = new Vector3();
			bottomRightRay.intersectPlane(topRightPlane, faceRight);

			// the left corner is the right one rotated.
			const faceLeft = faceRight.clone().applyAxisAngle(yAxis, -alpha);

			// and the final face on the twisted cap is the mid corner rotated.
			const leftMid = faceMid.clone().applyAxisAngle(yAxis, -alpha);

			numberFaceVertices3.push(faceMid, faceLeft, bottom, faceRight);
			capFaceVertices3.push(top, leftMid, faceLeft, faceMid);
		} else {
			numberFaceVertices3.push(right, left, bottom);
			capFaceVertices3.push(right, top, left);
		}

		const capFaceInfo = orientCoplanarVertices(capFaceVertices3);
		const numFaceInfo = orientCoplanarVertices(numberFaceVertices3);

		//const points = capFaceInfo.shape.getPoints();
		let face = numFaceInfo.shape;

		// in our case, we actually want the face to be slightly off center, as the numbers look better higher.
		let yOffset = -y / (isTwisted ? 9 : 6);
		[face] = translateShapes(new Vector2(0, yOffset), face);

		if (tens) {
			// if a "tens" dice, rotate the numbers 90deg by default
			[face] = rotateShapes(Math.PI / 2, face);
		}

		// the number faces, in numerical order.
		const faces: Array<DieFaceModel> = Array.from({ length: sides }).map((_, i) => {
			const yRot = yRotation(i, sides, alpha);
			const transform = new Transform();
			if (tens) {
				transform.rotateByAxisAngle(zAxis, -Math.PI / 2)
			}
			transform.translateBy(0, -yOffset, 0)
				.rotate(numFaceInfo.quat)
				.translate(numFaceInfo.offset)
				.rotateByAxisAngle(yAxis, yRot)
				.translateBy(0, (y - h) / 2, 0)
			return {
				isNumberFace: true,
				shape: face,
				defaultLegend: tens ? pickForDoublesByIndex(i) : pickForNumber(i, sides),
				transform
			};
		});

		for (let i = 0; i < sides; i++) {
			const yRot = yRotation(i, sides, alpha);
			const transform = new Transform()
				.rotate(capFaceInfo.quat)
				.translate(capFaceInfo.offset)
				.translateBy(0, (y - h) / 2, 0)
				.rotateByAxisAngle(yAxis, yRot)

			faces.push({
				isNumberFace: false,
				shape: capFaceInfo.shape,
				defaultLegend: Legend.BLANK,
				// top
				transform

			});
		}

		return {
			legendScaling: 1,
			faceToFaceDistance: d * 2,
			faces
		};
	};
}

function yRotation(i: number, sides: number, alpha: number): number {
	// rotate based on index.
	if (i == 0) {
		return 0;
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
	return rotation

}