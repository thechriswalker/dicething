// Odd-numbered dice (D3/D5/D7) as faceted-end hexagonal prisms - the Dice Lab
// approach to fair odd dice. A prism that can't settle on an end is the only way
// to make a fair odd-sided die; here the long sides are (skewed) hexagons left
// blank, and the two ends are faceted into the numbered faces.
//
// The geometry is the twisted-Crystal construction (see crystals.ts) with the
// roles inverted: the long body faces become BLANK and the cap facets carry the
// numbers. Each value 1..n is engraved on BOTH ends (so an n-sided prism has 2n
// cap facets); when rolled, one facet at each end points "mostly up" and the two
// match - that pair is the result.

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Transform } from '$lib/utils/3d';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices, rotateShapes } from '$lib/utils/shapes';
import { Plane, Quaternion, Ray, Shape, Vector2, Vector3 } from 'three';

const defaultLength = 18;
const defaultWidth = 10;
const defaultCapHeight = 3;
// the twist is what turns the long faces into hexagons and the end facets into
// readable quads. constrained to a tuned range rather than free (a 0 twist would
// give rectangular sides and degenerate triangular ends).
const defaultTwist = 0.25;

const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);

const oddPrismParameters: Array<DiceParameter> = [
	{ id: 'prism_length', defaultValue: defaultLength, min: 10, max: 60, step: 0.1 },
	{ id: 'prism_width', defaultValue: defaultWidth, min: 6, max: 40, step: 0.1 },
	{ id: 'prism_cap', defaultValue: defaultCapHeight, min: 1, max: 30, step: 0.1 },
	{ id: 'prism_twist', defaultValue: defaultTwist, min: 0.1, max: 0.9, step: 0.01 }
];

function customParameters(params: Record<string, number>): Array<DiceParameter> {
	return oddPrismParameters.map((p) => ({
		...p,
		defaultValue: params[p.id] ?? p.defaultValue
	}));
}

export const OddPrismD3 = oddPrism('d3_odd_prism', 'D3 Prism', 3);
export const OddPrismD5 = oddPrism('d5_odd_prism', 'D5 Prism', 5, {
	prism_length: 16,
	prism_width: 9,
	prism_cap: 5.6
});
export const OddPrismD7 = oddPrism('d7_odd_prism', 'D7 Prism', 7, {
	prism_length: 16,
	prism_width: 6,
	prism_cap: 5.2
});

function oddPrism(
	id: string,
	name: string,
	sides: number,
	customParams: Record<string, number> = {}
): DieModel {
	const parameters = customParameters(customParams);
	const defaultParameters = Object.fromEntries(parameters.map((p) => [p.id, p.defaultValue]));
	return { id, name, blankParameters: oddPrismBlankParams(sides, defaultParameters), parameters, build: build(sides, defaultParameters) };
}


function oddPrismBlankParams(sides: number, defaultParameters: Record<string, number>): (params: Record<string, number>, offset: number) => Record<string, number> {
	// we want to reduce face-2-face distance by offset*2.
	const alpha = (2 * Math.PI) / sides;
	const tanHalfAlpha = Math.tan(alpha / 2);
	return (params, offset) => {
		const x = params['prism_width'] ?? defaultParameters['prism_width'] ?? defaultWidth;
		const y = params['prism_length'] ?? defaultParameters['prism_length'] ?? defaultLength;
		const cap = params['prism_cap'] ?? defaultParameters['prism_cap'] ?? defaultCapHeight;
		const d = x / (2 * tanHalfAlpha);
		// this is the current center to face distance.
		// we want to find x so that d is reduced by offset.
		const xb = (d - offset) * 2 * tanHalfAlpha;
		// the height is reduced by 2*offset (one at each end)
		// and the cap height is reduced by offset.
		return {
			...params,
			prism_length: y - (offset),
			prism_cap: cap - offset,
			prism_width: xb
		};
	};
}
// orient a set of coplanar 3D vertices into a face shape + placement transform,
// ensuring the engraving front (+z) faces outward.
function orientedFace(verts: Array<Vector3>): { shape: Shape; transform: Transform } {
	const centroid = verts
		.reduce((acc, v) => acc.add(v.clone()), new Vector3())
		.multiplyScalar(1 / verts.length);
	let info = orientCoplanarVertices(verts.map((v) => v.clone()));
	if (info.normal.dot(centroid) < 0) {
		info = orientCoplanarVertices(verts.map((v) => v.clone()).reverse());
	}
	return { shape: info.shape, transform: new Transform().rotate(info.quat).translate(info.offset) };
}

function build(sides: number, defaultParameters: Record<string, number>): DieModel['build'] {
	if (!Number.isInteger(sides) || sides < 3) {
		throw new RangeError('odd prism needs at least 3 sides');
	}
	return (params) => {
		const x = params.prism_width ?? defaultParameters['prism_width'] ?? defaultWidth;
		const x2 = x / 2;
		const y = params.prism_length ?? defaultParameters['prism_length'] ?? defaultLength;
		const y2 = y / 2;
		const rot = params.prism_twist ?? defaultParameters['prism_twist'] ?? defaultTwist;
		const h = params.prism_cap ?? defaultParameters['prism_cap'] ?? defaultCapHeight;

		const alpha = (2 * Math.PI) / sides;
		const theta = alpha * rot;
		const d = x2 / Math.tan(alpha / 2); // centre to body-face distance.

		// build one cap facet (around the top apex) and one body face, exactly as
		// the twisted crystal does.
		const capFaceVertices3 = [new Vector3(0, h + y2, 0)];
		const bodyFaceVertices: Array<Vector2> = [];

		const plane = new Plane(new Vector3(0, 0, -1), d);
		const top = new Vector3().copy(capFaceVertices3[0]);
		const direction = new Vector3(-x2, y2, d).sub(top).applyAxisAngle(yAxis, theta).normalize();
		const intersection = new Vector3();
		new Ray(top, direction).intersectPlane(plane, intersection);
		const intersection2 = intersection.clone().applyAxisAngle(yAxis, -alpha);

		const cornerPlane = new Plane().setFromCoplanarPoints(intersection, top, intersection2);
		const corner = new Vector3();
		new Ray(new Vector3(-x2, 0, d), new Vector3(0, 1, 0)).intersectPlane(cornerPlane, corner);

		capFaceVertices3.push(intersection2, corner, intersection);

		const p = new Vector2(intersection.x, intersection.y);
		const q = p.clone().rotateAround(new Vector2(0, 0), Math.PI);
		const cornerHeight = corner.y;
		bodyFaceVertices.push(
			new Vector2(-x2, cornerHeight),
			p,
			new Vector2(x2, cornerHeight),
			new Vector2(x2, -cornerHeight),
			q,
			new Vector2(-x2, -cornerHeight)
		);

		// orientCoplanarVertices lays the facet out with the cap peak (the +y apex)
		// at the top of the 2D frame, so the engraved number reads upside-down for
		// someone looking at the die at rest. Turn the engraving frame a half turn -
		// rotating the 2D shape 180° and compensating with an equal turn about the
		// face normal - so the number's top points away from the cap peak while the
		// 3D facet geometry is unchanged.
		const oriented = orientedFace(capFaceVertices3);
		const cap = {
			shape: rotateShapes(Math.PI, oriented.shape)[0],
			transform: new Transform()
				.rotate(
					oriented.transform.rotation.multiply(new Quaternion().setFromAxisAngle(zAxis, Math.PI))
				)
				.translate(oriented.transform.translation)
		};
		const bodyShape = new Shape(bodyFaceVertices);

		// build the cap placements: top facets around the +y apex (one per side)
		// and bottom facets via the crystal's watertight 180°-about-z flip. that
		// flip mirrors the azimuth, so the bottom facet that shares a number with a
		// top facet is NOT the one with the same index - we work out the true
		// pairing from the geometry below.
		const topTransforms = Array.from({ length: sides }, (_, i) =>
			cap.transform.clone().rotateByAxisAngle(yAxis, i * alpha)
		);
		const bottomTransforms = topTransforms.map((t) => t.clone().rotateByAxisAngle(zAxis, Math.PI));

		const normalOf = (t: Transform) => new Vector3(0, 0, 1).applyQuaternion(t.rotation).normalize();
		const topNormals = topTransforms.map(normalOf);
		const bottomNormals = bottomTransforms.map(normalOf);
		// body faces point radially out in the xz-plane.
		const bodyNormals = Array.from(
			{ length: sides },
			(_, i) => new Vector3(Math.sin(i * alpha), 0, Math.cos(i * alpha))
		);

		// number the top facets in azimuth order, then find the matching bottom
		// facet for each: when the die rests on a body face, "up" is the opposite
		// radial direction; the top and bottom facets that point most that way are
		// the two the reader sees, so they must carry the same value.
		const topLegends = topTransforms.map((_, i) => pickForNumber(i, sides));
		const bottomLegends = new Array<Legend>(sides).fill(Legend.BLANK);
		const argmaxDot = (normals: Array<Vector3>, up: Vector3) => {
			let best = 0;
			let bestDot = -Infinity;
			normals.forEach((n, i) => {
				const dot = n.dot(up);
				if (dot > bestDot) {
					bestDot = dot;
					best = i;
				}
			});
			return best;
		};
		for (const bodyNormal of bodyNormals) {
			const up = bodyNormal.clone().multiplyScalar(-1);
			const ti = argmaxDot(topNormals, up);
			const bi = argmaxDot(bottomNormals, up);
			bottomLegends[bi] = topLegends[ti];
		}

		const faces: Array<DieFaceModel> = [];

		// the numbered cap facets: each value 1..n appears once on a top facet and
		// once on its paired bottom facet, so both ends read the same. The prism is
		// only fair if it can't settle on an end (you read the facets pointing up
		// while it rests on a blank body face), so the facets are flagged `noRest`:
		// if the caps grow tall enough to rest on, the stability check warns.
		for (let i = 0; i < sides; i++) {
			faces.push(
				{
					isNumberFace: true,
					noRest: true,
					shape: cap.shape,
					defaultLegend: topLegends[i],
					transform: topTransforms[i]
				},
				{
					isNumberFace: true,
					noRest: true,
					shape: cap.shape,
					defaultLegend: bottomLegends[i],
					transform: bottomTransforms[i]
				}
			);
		}

		// the blank hexagonal body faces.
		for (let i = 0; i < sides; i++) {
			const az = i * alpha;
			const transform = new Transform().translateBy(0, 0, d).rotateByAxisAngle(yAxis, az);
			faces.push({
				isNumberFace: false,
				shape: bodyShape,
				defaultLegend: Legend.BLANK,
				transform
			});
		}

		// crystals/prisms stand on a tip; raise so the lowest point sits on the
		// xz plane for printing.
		const printingTransform = new Transform().translateBy(0, (y + h) / 2, 0);

		stackedExplode(faces);

		return {
			faceToFaceDistance: d * 2,
			printingTransform,
			faces
		};
	};
}
