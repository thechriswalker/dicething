// Barrel dice ("rolling" / log dice): an antiprism band of congruent triangles
// closed at each end by a pyramidal cap.
//
// The body is two regular m-gon rings (radius r) at +/- height/2, offset by half
// a step (the antiprism twist). Connecting them gives 2m = N congruent isosceles
// triangles that alternate apex-up / apex-down around the barrel - the "ring of
// opposite-facing congruent triangles". These 2m triangles are the NUMBER faces,
// so a barrel always has an even side count. All 2m faces lie in one orbit of the
// antiprism's symmetry, so the die is fair for any radius/height.
//
// Each m-gon opening is closed by an m-sided pyramid (apex on the axis); those
// cap triangles are blank. The D4 is the degenerate m = 2 case: the rings become
// perpendicular edges and the caps vanish, leaving a stretched tetrahedron.
//
//   D4 -> m=2 (no caps)   D6 -> m=3 (triangular caps)   D8 -> m=4 (square)
//   D10 -> m=5 (pentagonal)  D12 -> m=6 (hexagonal)  D20 -> m=10 (decagonal)
//
// Number faces are built with an explicit local frame (apex = "up") so the digit
// reads upright with the triangle's point at the top, and so the band/cap edges
// share exact vertices and stay watertight.

import type { DieModel, DieFaceModel, DiceParameter } from '$lib/interfaces/dice';
import { Transform, previewTilt } from '$lib/utils/3d';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForDoublesByIndex, pickForNumber } from '$lib/utils/legends';
import { Matrix4, Quaternion, Shape, Vector2, Vector3 } from 'three';

const defaultHeight = 18;
const defaultRadius = 9;
const defaultCapHeight = 5;

const upAxis = new Vector3(0, 1, 0);

const barrelParameters: Array<DiceParameter> = [
	{ id: 'barrel_height', defaultValue: defaultHeight, min: 6, max: 60, step: 1 },
	{ id: 'barrel_radius', defaultValue: defaultRadius, min: 4, max: 40, step: 0.5 },
	{ id: 'barrel_cap', defaultValue: defaultCapHeight, min: 1, max: 30, step: 0.2 }
];

// the high-count barrels (d20, d%) have tall, narrow triangles and wide two-digit
// legends, which read/fit far better turned 90 degrees (apex pointing "right").
export const BarrelD4 = barrel('d4_barrel', 'D4 Barrel', 4);
export const BarrelD6 = barrel('d6_barrel', 'D6 Barrel', 6);
export const BarrelD8 = barrel('d8_barrel', 'D8 Barrel', 8);
export const BarrelD10 = barrel('d10_barrel', 'D10 Barrel', 10);
export const BarrelD12 = barrel('d12_barrel', 'D12 Barrel', 12);
export const BarrelD20 = barrel('d20_barrel', 'D20 Barrel', 20, false, true);
export const BarrelD00 = barrel('d00_barrel', 'D% Barrel', 10, true, true);

function barrel(
	id: string,
	name: string,
	sides: number,
	tens = false,
	turnRight = false
): DieModel {
	if (sides % 2 === 1) {
		throw new RangeError('sides cannot be odd for a barrel die');
	}
	return { id, name, parameters: barrelParameters, build: build(sides, tens, turnRight) };
}

const centroidOf = (verts: Array<Vector3>): Vector3 =>
	verts.reduce((acc, v) => acc.add(v), new Vector3()).multiplyScalar(1 / verts.length);

const normalOf = (a: Vector3, b: Vector3, c: Vector3): Vector3 =>
	new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();

// A flat triangular number face whose 2D frame has the triangle's apex pointing
// "up" (+y), or "right" (+x) when `turnRight` is set, and whose +z is the outward
// normal, so the digit reads upright (or quarter-turned) and the geometry lands
// exactly back on `verts` (apex first). libtess normalises the front-cap winding
// to +z, so the input order only needs to give an outward normal here. Choosing a
// different in-plane axis pair only relabels the 2D frame; it leaves the
// reconstructed 3D triangle identical.
const _basis = new Matrix4();
function triangleFace(
	apex: Vector3,
	baseL: Vector3,
	baseR: Vector3,
	turnRight: boolean
): { shape: Shape; quat: Quaternion; centroid: Vector3 } {
	const verts = [apex, baseL, baseR];
	const centroid = centroidOf(verts);
	let n = normalOf(apex, baseL, baseR);
	if (n.dot(centroid) < 0) {
		n.negate();
	}
	// apexDir points from the centroid to the apex (already in-plane). Apex-up uses
	// it as +y; turnRight rotates the frame a quarter turn so the apex sits at +x.
	const apexDir = apex.clone().sub(centroid).projectOnPlane(n).normalize();
	const up = turnRight ? apexDir.clone().cross(n).normalize().negate() : apexDir;
	const right = turnRight ? apexDir : apexDir.clone().cross(n).normalize();
	const to2D = (p: Vector3) => {
		const d = p.clone().sub(centroid);
		return new Vector2(d.dot(right), d.dot(up));
	};
	const shape = new Shape(verts.map(to2D));
	_basis.makeBasis(right, up, n);
	const quat = new Quaternion().setFromRotationMatrix(_basis);
	return { shape, quat, centroid };
}

// A blank cap facet (pyramid tip = apex, the two ring vertices = base edge shared
// with the barrel). Built through triangleFace so it gets the same apex-up frame
// as the number faces: every congruent cap triangle then sits identically rotated
// in the exploded view - an upward isosceles triangle with the barrel edge
// horizontal along the bottom.
function cap(apex: Vector3, baseL: Vector3, baseR: Vector3): DieFaceModel {
	const { shape, quat, centroid } = triangleFace(apex, baseL, baseR, false);
	return {
		isNumberFace: false,
		shape,
		defaultLegend: Legend.BLANK,
		transform: new Transform().rotate(quat).translate(centroid)
	};
}

function build(sides: number, tens: boolean, turnRight: boolean): DieModel['build'] {
	return (params) => {
		const height = params.barrel_height ?? defaultHeight;
		const radius = params.barrel_radius ?? defaultRadius;
		const capHeight = params.barrel_cap ?? defaultCapHeight;

		const m = sides / 2; // vertices per ring (and faces per cap)
		const step = (2 * Math.PI) / m;
		const y2 = height / 2;

		// ring vertices. azimuth 0 points along +z; the bottom ring is offset by
		// half a step (the antiprism twist) so the connecting faces are triangles.
		const topV = (a: number) => new Vector3(radius * Math.sin(a), y2, radius * Math.cos(a));
		const botV = (a: number) => new Vector3(radius * Math.sin(a), -y2, radius * Math.cos(a));

		// numbering: opposite faces (across the barrel) sum to N+1. This scatters
		// the slot -> value mapping the same way the crystal/shard dice do, so the
		// 3D placement keeps the "opposite" rule while the exploded view is sorted.
		const numberForSlot = (j: number) => (j < m ? j + 1 : sides - (j - m));

		// Faces are collected by legend value (not azimuth slot) so the exploded /
		// editing view lists them 1..N in order; each cap inherits the value of the
		// band face it shares a ring edge with and sits in the same column.
		const bandByValue: Array<DieFaceModel> = new Array(sides);
		const capByValue: Array<DieFaceModel> = new Array(sides);

		// the 2m band triangles, in azimuth order. even slots point apex-up (apex on
		// the top ring), odd slots apex-down (apex on the bottom ring).
		for (let j = 0; j < sides; j++) {
			const k = Math.floor(j / 2);
			let apex: Vector3;
			let baseL: Vector3;
			let baseR: Vector3;
			if (j % 2 === 0) {
				apex = topV(k * step);
				baseL = botV((k - 0.5) * step);
				baseR = botV((k + 0.5) * step);
			} else {
				apex = botV((k + 0.5) * step);
				baseL = topV(k * step);
				baseR = topV((k + 1) * step);
			}
			const { shape, quat, centroid } = triangleFace(apex, baseL, baseR, turnRight);
			const value = numberForSlot(j);
			bandByValue[value - 1] = {
				isNumberFace: true,
				shape,
				defaultLegend: tens ? pickForDoublesByIndex(value - 1) : pickForNumber(value - 1, sides),
				transform: new Transform().rotate(quat).translate(centroid)
			};
		}

		// pyramidal caps close each m-gon opening. m = 2 (the D4) has digon
		// openings (just edges), so the band already closes the solid - no caps.
		// A top cap's base edge is shared with apex-down band slot 2k+1; a bottom
		// cap's with apex-up slot 2k+2, so each cap maps to that face's value.
		if (m >= 3) {
			const topApex = new Vector3(0, y2 + capHeight, 0);
			const botApex = new Vector3(0, -(y2 + capHeight), 0);
			for (let k = 0; k < m; k++) {
				const topValue = numberForSlot((2 * k + 1) % sides);
				const botValue = numberForSlot((2 * k + 2) % sides);
				capByValue[topValue - 1] = cap(topApex, topV(k * step), topV((k + 1) * step));
				capByValue[botValue - 1] = cap(botApex, botV((k + 1.5) * step), botV((k + 0.5) * step));
			}
		}

		const faces: Array<DieFaceModel> = [...bandByValue, ...capByValue.filter(Boolean)];

		// the inradius of the band (origin -> a number-face plane); used for the
		// printing rest and the reported face-to-face size.
		const face0 = faces[0];
		const n0 = new Vector3(0, 0, 1).applyQuaternion(face0.transform.rotation);
		const rho = Math.abs(face0.transform.translation.dot(n0));

		// print lying on a band face: rotate that face's outward normal to point
		// straight down, then raise the die so the resting face sits on the plate.
		const flat = new Quaternion().setFromUnitVectors(n0, new Vector3(0, -1, 0));
		const printingTransform = new Transform().rotate(flat).translateBy(0, rho, 0);

		stackedExplode(faces);

		return {
			faces,
			faceToFaceDistance: 2 * rho,
			printingTransform,
			// head-on a single triangle hides the elongated barrel; tilt to reveal it.
			previewTransform: previewTilt()
		};
	};
}
