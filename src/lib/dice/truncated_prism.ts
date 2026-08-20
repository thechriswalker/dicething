// D3 truncated prism: the odd-prism (Dice Lab) construction with the three
// sharp long edges chamfered off. The barrel becomes six faces — three large
// blank resting faces alternating with three narrow blank bevels — and each
// end still has exactly three numbered cap facets.
//
// Cross-section is an irregular hexagon with C3 symmetry. `prism_width` is the
// chord width of each large face; `prism_bevel` is the chord width of each
// small face. The inradii follow from those two lengths (see `crossSection`).
// The bevels are left as ordinary blank faces (not `noRest`): any radial side
// face has the COM projecting into its centre, so flagging them would always
// warn. Keep them narrow so the die tips onto a large face in practice.

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Transform } from '$lib/utils/3d';
import { PRINT_CLEARANCE_MM } from '$lib/utils/printing';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices, rotateShapes } from '$lib/utils/shapes';
import { Matrix3, Plane, Quaternion, Ray, Shape, Vector2, Vector3 } from 'three';

const sides = 3;
const alpha = (2 * Math.PI) / sides;
const tanHalf = Math.tan(alpha / 2);

const defaultLength = 18;
const defaultWidth = 10;
const defaultBevel = 2.5;
const defaultCapHeight = 3;
const defaultTwist = 0.25;

const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);

const truncatedPrismParameters: Array<DiceParameter> = [
	{ id: 'prism_length', defaultValue: defaultLength, min: 10, max: 60, step: 0.1 },
	{ id: 'prism_width', defaultValue: defaultWidth, min: 6, max: 40, step: 0.1 },
	{ id: 'prism_bevel', defaultValue: defaultBevel, min: 0.5, max: 20, step: 0.1 },
	{ id: 'prism_cap', defaultValue: defaultCapHeight, min: 1, max: 30, step: 0.1 },
	{ id: 'prism_twist', defaultValue: defaultTwist, min: 0.1, max: 0.9, step: 0.01 }
];

export const TruncatedPrismD3: DieModel = {
	id: 'd3_truncated_prism',
	name: 'D3 Truncated Prism',
	parameters: truncatedPrismParameters,
	blankParameters: truncatedPrismBlankParams(
		Object.fromEntries(truncatedPrismParameters.map((p) => [p.id, p.defaultValue]))
	),
	build: build(Object.fromEntries(truncatedPrismParameters.map((p) => [p.id, p.defaultValue])))
};

// Large-face inradius `d` and bevel inradius `r` from the two chord widths.
function crossSection(
	largeWidth: number,
	bevelWidth: number
): { d: number; r: number; x2: number } {
	const x2 = largeWidth / 2;
	// d = (x2 + bevelWidth) / tan(α/2); r = 2d − (bevelWidth/2)·tan(α/2).
	// At bevelWidth → 0 this collapses to the sharp triangular odd-prism section
	// (r → 2d, the circumradius). At largeWidth = bevelWidth it is a regular hexagon.
	const d = (x2 + bevelWidth) / tanHalf;
	const r = 2 * d - (bevelWidth / 2) * tanHalf;
	return { d, r, x2 };
}

function truncatedPrismBlankParams(
	defaultParameters: Record<string, number>
): (params: Record<string, number>, offset: number) => Record<string, number> {
	return (params, offset) => {
		const x = params['prism_width'] ?? defaultParameters['prism_width'] ?? defaultWidth;
		const bevel = params['prism_bevel'] ?? defaultParameters['prism_bevel'] ?? defaultBevel;
		const y = params['prism_length'] ?? defaultParameters['prism_length'] ?? defaultLength;
		const cap = params['prism_cap'] ?? defaultParameters['prism_cap'] ?? defaultCapHeight;
		const { d, r } = crossSection(x, bevel);
		const d2 = d - offset;
		const r2 = r - offset;
		// Invert crossSection: x2 = (2r − d)/tan(α/2), bevel = 2(2d − r)/tan(α/2).
		const x2b = (2 * r2 - d2) / tanHalf;
		const bevelB = (2 * (2 * d2 - r2)) / tanHalf;
		return {
			...params,
			prism_length: y - offset,
			prism_cap: cap - offset,
			prism_width: Math.max(0.1, 2 * x2b),
			prism_bevel: Math.max(0.1, bevelB)
		};
	};
}

function bodyPlane(az: number, dist: number): Plane {
	return new Plane(new Vector3(Math.sin(az), 0, Math.cos(az)), -dist);
}

function planeTriple(a: Plane, b: Plane, c: Plane): Vector3 {
	const m = new Matrix3().set(
		a.normal.x,
		a.normal.y,
		a.normal.z,
		b.normal.x,
		b.normal.y,
		b.normal.z,
		c.normal.x,
		c.normal.y,
		c.normal.z
	);
	return new Vector3(-a.constant, -b.constant, -c.constant).applyMatrix3(m.invert());
}

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

function build(defaultParameters: Record<string, number>): DieModel['build'] {
	return (params) => {
		const x = params.prism_width ?? defaultParameters['prism_width'] ?? defaultWidth;
		const bevel = params.prism_bevel ?? defaultParameters['prism_bevel'] ?? defaultBevel;
		const y = params.prism_length ?? defaultParameters['prism_length'] ?? defaultLength;
		const y2 = y / 2;
		const rot = params.prism_twist ?? defaultParameters['prism_twist'] ?? defaultTwist;
		const h = params.prism_cap ?? defaultParameters['prism_cap'] ?? defaultCapHeight;
		const theta = alpha * rot;
		const { d, r, x2 } = crossSection(x, bevel);

		const apex = new Vector3(0, h + y2, 0);
		const large0 = bodyPlane(0, d);
		const largeM = bodyPlane(-alpha, d);
		const truncL = bodyPlane(-alpha / 2, r);

		// Twist hit on the large face (same ray as the odd prism), then the
		// matching hit on the previous large face. Together with the apex they
		// define the numbered cap plane that sits over this bevel.
		const direction = new Vector3(-x2, y2, d).sub(apex).applyAxisAngle(yAxis, theta).normalize();
		const intersection = new Vector3();
		if (!new Ray(apex, direction).intersectPlane(large0, intersection)) {
			throw new Error('truncated prism: twist ray missed large face');
		}
		const intersection2 = intersection.clone().applyAxisAngle(yAxis, -alpha);
		const capPlane = new Plane().setFromCoplanarPoints(intersection, apex, intersection2);

		// Top edge of the bevel: where the cap plane cuts the two large∩bevel lines.
		const leftTop = planeTriple(large0, truncL, capPlane);
		const truncTopM = planeTriple(largeM, truncL, capPlane);
		// Right top corner of the large face = this bevel's far corner, spun one sector.
		const rightTop = truncTopM.clone().applyAxisAngle(yAxis, alpha);

		// Numbered cap: pentagon (apex + twist hits on both larges + bevel top edge).
		const capVerts = [apex, intersection2, truncTopM, leftTop, intersection];
		const oriented = orientedFace(capVerts);
		const cap = {
			shape: rotateShapes(Math.PI, oriented.shape)[0],
			transform: new Transform()
				.rotate(
					oriented.transform.rotation.multiply(new Quaternion().setFromAxisAngle(zAxis, Math.PI))
				)
				.translate(oriented.transform.translation)
		};

		// Large blank face in its own frame (u = world x, v = world y on z = d).
		// Twist breaks left/right height symmetry, so both corners are kept as-is.
		// Bottom half is the face-local 180° of the top in odd-prism order
		// (A,B,C,-A,-B,-C) — that puts the vertical side edges at constant ±x.
		const largeShape = new Shape([
			new Vector2(leftTop.x, leftTop.y),
			new Vector2(intersection.x, intersection.y),
			new Vector2(rightTop.x, rightTop.y),
			new Vector2(-leftTop.x, -leftTop.y),
			new Vector2(-intersection.x, -intersection.y),
			new Vector2(-rightTop.x, -rightTop.y)
		]);

		// Bevel face: same placement convention as the large faces (shape in z=0,
		// translate by inradius, then rotY). Un-rotate the top edge into the az=0
		// frame so (x, y) are the shape coords; bottom is A,B,-A,-B.
		const unrot = (p: Vector3) => p.clone().applyAxisAngle(yAxis, alpha / 2);
		const bLeft = unrot(leftTop);
		const bRight = unrot(truncTopM);
		const bevelShape = new Shape([
			new Vector2(bLeft.x, bLeft.y),
			new Vector2(bRight.x, bRight.y),
			new Vector2(-bLeft.x, -bLeft.y),
			new Vector2(-bRight.x, -bRight.y)
		]);

		const topTransforms = Array.from({ length: sides }, (_, i) =>
			cap.transform.clone().rotateByAxisAngle(yAxis, i * alpha)
		);
		const bottomTransforms = topTransforms.map((t) => t.clone().rotateByAxisAngle(zAxis, Math.PI));

		const normalOf = (t: Transform) => new Vector3(0, 0, 1).applyQuaternion(t.rotation).normalize();
		const topNormals = topTransforms.map(normalOf);
		const bottomNormals = bottomTransforms.map(normalOf);
		// Rest faces are the large blank sides (bevels are too narrow to count).
		const largeNormals = Array.from(
			{ length: sides },
			(_, i) => new Vector3(Math.sin(i * alpha), 0, Math.cos(i * alpha))
		);

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
		for (const bodyNormal of largeNormals) {
			const up = bodyNormal.clone().multiplyScalar(-1);
			bottomLegends[argmaxDot(bottomNormals, up)] = topLegends[argmaxDot(topNormals, up)];
		}

		const faces: Array<DieFaceModel> = [];

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

		for (let i = 0; i < sides; i++) {
			const az = i * alpha;
			faces.push({
				isNumberFace: false,
				shape: largeShape,
				defaultLegend: Legend.BLANK,
				transform: new Transform().translateBy(0, 0, d).rotateByAxisAngle(yAxis, az)
			});
		}

		for (let i = 0; i < sides; i++) {
			const az = -alpha / 2 + i * alpha;
			faces.push({
				isNumberFace: false,
				shape: bevelShape,
				defaultLegend: Legend.BLANK,
				transform: new Transform().translateBy(0, 0, r).rotateByAxisAngle(yAxis, az)
			});
		}

		const printingTransform = new Transform().translateBy(0, (y + h) / 2 + PRINT_CLEARANCE_MM, 0);

		stackedExplode(faces);

		return {
			faceToFaceDistance: d * 2,
			printingTransform,
			faces
		};
	};
}
