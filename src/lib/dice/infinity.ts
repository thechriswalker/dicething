// D4 "Infinity": a square-section bar with two rounded (half-cylinder) ends
// whose axes are perpendicular to each other - the classic 4-sided rolling-log
// die. It can never settle on an end, so the single face that lands on top is
// the read value.
//
// Each of the 4 number faces is a flat "bullet": a (W x L) rectangle capped by a
// semicircle (radius W/2) on ONE short end. Laid edge to edge with the semicircle
// end ALTERNATING (top / bottom / top / bottom), the strip wraps into a square
// tube. Opposite faces therefore share an end: the two faces at the +y end supply
// the flat semicircular sides of a half-cylinder there (axis along z), and the
// two faces at the -y end do the same for a half-cylinder turned 90 degrees (axis
// along x). The curved lateral surfaces of those two half-cylinders are built as
// `hidden` facets - part of the geometry/export but never listed or selectable,
// exactly like the coin's rim - leaving just the 4 editable number faces.
//
// Watertightness relies on the face semicircles and the cap facets sharing the
// SAME arc subdivision (CAP_SEGMENTS chords over the 180 degree arc), so their
// boundary vertices coincide.

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { previewTilt, Transform } from '$lib/utils/3d';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices } from '$lib/utils/shapes';
import { Shape, Vector2, Vector3 } from 'three';

const defaultWidth = 12;
const defaultLength = 18;
// roundness of the half-cylinder ends (chords over the 180 degree arc). fixed:
// high enough to read as smooth, and not worth a slider for this shape.
const CAP_SEGMENTS = 48;

const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);

const infinityParameters: Array<DiceParameter> = [
	{ id: 'infinity_width', defaultValue: defaultWidth, min: 6, max: 40, step: 0.5 },
	{ id: 'infinity_length', defaultValue: defaultLength, min: 4, max: 60, step: 0.5 }
];

// the flat outline of one number face, centred on its rectangle (so the legend,
// placed at the local origin, sits in the middle of the long face). wound
// clockwise viewed from +z / outside, matching the other dice's front-face
// convention. the semicircle is a CAP_SEGMENTS-chord polyline so its points land
// exactly on the half-cylinder cap facets it shares an edge with.
function bulletPoints(halfW: number, halfL: number): Array<Vector2> {
	const pts: Array<Vector2> = [];
	// semicircle, left base -> apex -> right base (t: pi -> 0).
	for (let k = 0; k <= CAP_SEGMENTS; k++) {
		const t = Math.PI - (k / CAP_SEGMENTS) * Math.PI;
		pts.push(new Vector2(halfW * Math.cos(t), halfL + halfW * Math.sin(t)));
	}
	// down the far (straight) short end and back along the side.
	pts.push(new Vector2(halfW, -halfL), new Vector2(-halfW, -halfL));
	return pts;
}

// build a hidden (non-UI) facet from its 3D corners, orienting its engraving
// front to point away from the origin so it shades correctly from outside (the
// solid surrounds the origin).
function hiddenFacet(corners: Array<Vector3>): DieFaceModel {
	const centroid = corners
		.reduce((acc, v) => acc.add(v), new Vector3())
		.multiplyScalar(1 / corners.length);
	let info = orientCoplanarVertices(corners);
	if (info.normal.dot(centroid) < 0) {
		info = orientCoplanarVertices([...corners].reverse());
	}
	return {
		isNumberFace: false,
		hidden: true,
		shape: info.shape,
		defaultLegend: Legend.BLANK,
		transform: new Transform().rotate(info.quat).translate(info.offset)
	};
}

export const InfinityD4: DieModel = {
	id: 'd4_infinity',
	name: 'D4 Infinity',
	parameters: infinityParameters,
	build(params) {
		const width = params.infinity_width ?? defaultWidth;
		const length = params.infinity_length ?? defaultLength;
		const hw = width / 2;
		const hl = length / 2;

		const bullet = bulletPoints(hw, hl);
		const bulletShape = () => new Shape(bullet.map((p) => p.clone()));

		// every number face is the SAME bullet (rectangle + semicircle on top), so
		// the exploded/editing view shows four identical curve-up faces. The +x/-x
		// faces' rounded ends physically sit at the bottom of the bar, so they get a
		// 180-degree spin about the face normal: that lands the (curve-up) shape with
		// its curve at the -y end exactly where the previous mirrored shape did, so
		// the solid is unchanged. opposite faces' values sum to 5.
		const faces: Array<DieFaceModel> = [
			{
				// +z
				isNumberFace: true,
				shape: bulletShape(),
				defaultLegend: pickForNumber(0, 4),
				transform: new Transform().translateBy(0, 0, hw)
			},
			{
				// +x (rounded end at -y)
				isNumberFace: true,
				shape: bulletShape(),
				defaultLegend: pickForNumber(1, 4),
				transform: new Transform()
					.rotateByAxisAngle(zAxis, Math.PI)
					.rotateByAxisAngle(yAxis, Math.PI / 2)
					.translateBy(hw, 0, 0)
			},
			{
				// -x (rounded end at -y)
				isNumberFace: true,
				shape: bulletShape(),
				defaultLegend: pickForNumber(2, 4),
				transform: new Transform()
					.rotateByAxisAngle(zAxis, Math.PI)
					.rotateByAxisAngle(yAxis, -Math.PI / 2)
					.translateBy(-hw, 0, 0)
			},
			{
				// -z
				isNumberFace: true,
				shape: bulletShape(),
				defaultLegend: pickForNumber(3, 4),
				transform: new Transform().translateBy(0, 0, hw).rotateByAxisAngle(yAxis, Math.PI)
			}
		];

		// the top half-cylinder cap (axis along z): its flat semicircular ends are
		// the +y semicircles of the +z/-z faces, so only the curved lateral surface
		// is built here, as hidden quad facets sharing the faces' arc points.
		for (let k = 0; k < CAP_SEGMENTS; k++) {
			const a0 = (k / CAP_SEGMENTS) * Math.PI;
			const a1 = ((k + 1) / CAP_SEGMENTS) * Math.PI;
			const x0 = hw * Math.cos(a0);
			const y0 = hl + hw * Math.sin(a0);
			const x1 = hw * Math.cos(a1);
			const y1 = hl + hw * Math.sin(a1);
			faces.push(
				hiddenFacet([
					new Vector3(x0, y0, hw),
					new Vector3(x1, y1, hw),
					new Vector3(x1, y1, -hw),
					new Vector3(x0, y0, -hw)
				])
			);
		}

		// the bottom half-cylinder cap (axis along x), perpendicular to the top one:
		// its flat ends are the -y semicircles of the +x/-x faces.
		for (let k = 0; k < CAP_SEGMENTS; k++) {
			const a0 = (k / CAP_SEGMENTS) * Math.PI;
			const a1 = ((k + 1) / CAP_SEGMENTS) * Math.PI;
			const z0 = hw * Math.cos(a0);
			const y0 = -hl - hw * Math.sin(a0);
			const z1 = hw * Math.cos(a1);
			const y1 = -hl - hw * Math.sin(a1);
			faces.push(
				hiddenFacet([
					new Vector3(hw, y0, z0),
					new Vector3(hw, y1, z1),
					new Vector3(-hw, y1, z1),
					new Vector3(-hw, y0, z0)
				])
			);
		}

		stackedExplode(faces);

		// print lying on a face: lay the bar down so its axis runs along z, then
		// raise the resting face onto the build plate.
		const printingTransform = new Transform()
			.rotateByAxisAngle(xAxis, Math.PI / 2)
			.translateBy(0, hw, 0);

		return {
			faces,
			faceToFaceDistance: width,
			printingTransform,
			// looking dead-on at a single flat face hides the rounded ends; tilt to
			// reveal the bar shape.
			previewTransform: previewTilt()
		};
	}
};
