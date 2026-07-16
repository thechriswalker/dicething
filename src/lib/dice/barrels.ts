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
//
// Twist (crystal-style faceted caps, m >= 3 only): each pyramidal cap can be
// replaced by a ring of kite quads spiralling up to the apex. A raised mid-vertex
// is added to every ring edge, which also turns each band triangle into a quad
// (the crystal's rectangle has two ring edges -> hexagon; a band triangle has
// one -> quad). Each mid is solved so BOTH its band quad and its cap quad are
// planar while the ring vertices stay put - see solveTwistMid().

import type { DieModel, DieFaceModel, DiceParameter } from '$lib/interfaces/dice';
import { Transform, previewTilt } from '$lib/utils/3d';
import { liftOnlyPrintingTransform } from '$lib/utils/printing';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForDoublesByIndex, pickForNumber } from '$lib/utils/legends';
import { Matrix4, Quaternion, Shape, Vector2, Vector3 } from 'three';

const defaultHeight = 18;
const defaultRadius = 9;
const defaultD4Radius = 6
const defaultCapHeight = 5;
const defaultTwist = 0;

function barrelParameters(sides: number): Array<DiceParameter> {
	const params: Array<DiceParameter> = [
		{ id: 'barrel_height', defaultValue: defaultHeight, min: 6, max: 60, step: 0.1 },
		{ id: 'barrel_radius', defaultValue: sides === 4 ? defaultD4Radius : defaultRadius, min: 4, max: 40, step: 0.1 }
	];
	// the D4 (m = 2) has no caps, so neither the cap height nor the twist apply.
	if (sides / 2 >= 3) {
		params.push(
			{ id: 'barrel_cap', defaultValue: defaultCapHeight, min: 1, max: 30, step: 0.1 },
			{ id: 'barrel_twist', defaultValue: defaultTwist, min: 0, max: 0.95, step: 0.01 }
		);
	}
	return params;
}

// the high-count barrels (d20, d%) have tall, narrow triangles and wide two-digit
// legends, which read/fit far better turned 90 degrees (apex pointing "right").
export const BarrelD4 = barrel('d4_barrel', 'D4 Wedge', 4);
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
	const params = barrelParameters(sides);
	const defaultParameters = Object.fromEntries(params.map(p => [p.id, p.defaultValue]));
	return { id, name, blankParameters: barrelBlankParams(sides, defaultParameters),
		 parameters: params, build: build(sides, defaultParameters, tens, turnRight) };
}

function barrelBlankParams(
	sides: number,
	defaultParameters: Record<string, number>
): (params: Record<string, number>, offset: number) => Record<string, number> {
	// we want to reduce face-2-face distance by offset*2.
	const alpha = (2 * Math.PI) / sides;
	const tanHalfAlpha = Math.tan(alpha / 2);
	return (params, offset) => {
		const x = params['barrel_radius'] ?? defaultParameters['barrel_radius'] ?? defaultRadius;
		const y = params['barrel_height'] ?? defaultParameters['barrel_height'] ?? defaultHeight;
		const cap = params['barrel_cap'] ?? defaultParameters['barrel_cap'] ?? defaultCapHeight;
		const d = x / (2 * tanHalfAlpha);
		// this is the current center to face distance.
		// we want to find x so that d is reduced by offset.
		const xb = (d - offset) * 2 * tanHalfAlpha;
		// the height is reduced by 2*offset (one at each end)
		// and the cap height is reduced by offset.
		return {
			...params,
			barrel_height: y - (offset * 2),
			barrel_cap: cap - offset,
			barrel_radius: xb
		};
	};
}

const centroidOf = (verts: Array<Vector3>): Vector3 =>
	verts.reduce((acc, v) => acc.add(v), new Vector3()).multiplyScalar(1 / verts.length);

// Newell's method: a robust face normal for an arbitrary (planar) polygon loop.
const polygonNormal = (verts: Array<Vector3>): Vector3 => {
	const n = new Vector3();
	for (let i = 0; i < verts.length; i++) {
		const a = verts[i];
		const b = verts[(i + 1) % verts.length];
		n.x += (a.y - b.y) * (a.z + b.z);
		n.y += (a.z - b.z) * (a.x + b.x);
		n.z += (a.x - b.x) * (a.y + b.y);
	}
	return n.normalize();
};

// A flat polygonal face (triangle or quad) whose 2D frame points `apex` "up" (+y),
// or "right" (+x) when `turnRight` is set, and whose +z is the outward normal, so
// the digit reads upright (or quarter-turned) and the geometry lands exactly back
// on `verts`. libtess normalises the front-cap winding to +z, so the input order
// only needs to give an outward normal. Choosing a different in-plane axis pair
// only relabels the 2D frame; it leaves the reconstructed 3D face identical.
const _basis = new Matrix4();
function orientedFace(
	verts: Array<Vector3>,
	apex: Vector3,
	turnRight: boolean
): { shape: Shape; quat: Quaternion; centroid: Vector3 } {
	const centroid = centroidOf(verts);
	const n = polygonNormal(verts);
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
	const pts2d = verts.map(to2D);
	// normalise to a consistent (counter-clockwise) winding so every congruent
	// face yields an identical loop - apex-up and apex-down quads are otherwise
	// traversed in opposite senses, which would flip the engraving wall direction.
	let area2 = 0;
	for (let i = 0; i < pts2d.length; i++) {
		const a = pts2d[i];
		const b = pts2d[(i + 1) % pts2d.length];
		area2 += a.x * b.y - b.x * a.y;
	}
	if (area2 < 0) pts2d.reverse();
	const shape = new Shape(pts2d);
	_basis.makeBasis(right, up, n);
	const quat = new Quaternion().setFromRotationMatrix(_basis);
	return { shape, quat, centroid };
}

// Solve the raised mid-vertex for a twisted ring edge. The mid sits at a fixed
// azimuth `psi` (its twist offset); we solve its radius+height so it is coplanar
// with the band face it belongs to AND with the cap quad spanning the apex P and
// the two adjacent ring vertices. The band-plane constraint is linear in (r, y)
// and the cap-coplanarity is a scalar triple product, so the combined condition
// is a quadratic in r whose non-trivial root r = -P1/P2 is the answer.
function solveTwistMid(
	P: Vector3,
	ringVert: Vector3, // a ring corner shared by this mid's two cap quads
	bandA: Vector3, // the band face this mid extends (planarity target)
	bandB: Vector3,
	psi: number,
	psiPrev: number
): { r: number; y: number } {
	const ey = new Vector3(0, 1, 0);
	const u = new Vector3(Math.sin(psi), 0, Math.cos(psi));
	const uPrev = new Vector3(Math.sin(psiPrev), 0, Math.cos(psiPrev));
	const nB = new Vector3()
		.subVectors(ringVert, bandA)
		.cross(new Vector3().subVectors(bandB, bandA));
	const a = nB.dot(u);
	const b = nB.dot(ey);
	const c = nB.dot(bandA);
	// band plane => y is linear in r: y = (c - a r) / b.
	const beta = a / b;
	const alpha = (c - b * P.y) / b;
	const A0 = u.clone().addScaledVector(ey, -beta);
	const Am = uPrev.clone().addScaledVector(ey, -beta);
	const D = new Vector3().subVectors(ringVert, P);
	const P2 = A0.dot(new Vector3().crossVectors(D, Am));
	const P1 =
		alpha * (A0.dot(new Vector3().crossVectors(D, ey)) + ey.dot(new Vector3().crossVectors(D, Am)));
	const r = -P1 / P2;
	return { r, y: (c - a * r) / b };
}

// A blank cap facet, oriented (apex "up") so every congruent cap sits identically
// rotated in the exploded view, with the barrel-shared corner at the bottom.
function cap(verts: Array<Vector3>, apex: Vector3): DieFaceModel {
	const { shape, quat, centroid } = orientedFace(verts, apex, false);
	return {
		isNumberFace: false,
		shape,
		defaultLegend: Legend.BLANK,
		transform: new Transform().rotate(quat).translate(centroid)
	};
}

function build(sides: number, defaultParameters: Record<string, number>, tens: boolean, turnRight: boolean): DieModel['build'] {
	return (params) => {
		const height = params.barrel_height ?? defaultParameters.barrel_height ?? defaultHeight;
		const radius = params.barrel_radius ?? defaultParameters.barrel_radius ?? (sides === 4 ? defaultD4Radius : defaultRadius);
		const capHeight = params.barrel_cap ?? defaultParameters.barrel_cap ?? defaultCapHeight;

		const m = sides / 2; // vertices per ring (and faces per cap)
		const step = (2 * Math.PI) / m;
		const y2 = height / 2;

		// ring vertices. azimuth 0 points along +z; the bottom ring is offset by
		// half a step (the antiprism twist) so the connecting faces are triangles.
		const topV = (a: number) => new Vector3(radius * Math.sin(a), y2, radius * Math.cos(a));
		const botV = (a: number) => new Vector3(radius * Math.sin(a), -y2, radius * Math.cos(a));

		const twist = m >= 3 ? (params.barrel_twist ?? defaultTwist) : 0;

		// numbering: opposite faces (across the barrel) sum to N+1. This scatters
		// the slot -> value mapping the same way the crystal/shard dice do, so the
		// 3D placement keeps the "opposite" rule while the exploded view is sorted.
		const numberForSlot = (j: number) => (j < m ? j + 1 : sides - (j - m));

		// Faces are collected by legend value (not azimuth slot) so the exploded /
		// editing view lists them 1..N in order; each cap inherits the value of the
		// band face whose apex ring-vertex it wraps, and sits in the same column.
		const bandByValue: Array<DieFaceModel> = new Array(sides);
		const capByValue: Array<DieFaceModel> = new Array(sides);

		const numberFace = (verts: Array<Vector3>, apex: Vector3, value: number): DieFaceModel => {
			const { shape, quat, centroid } = orientedFace(verts, apex, turnRight);
			return {
				isNumberFace: true,
				shape,
				defaultLegend: tens ? pickForDoublesByIndex(value - 1) : pickForNumber(value - 1, sides),
				transform: new Transform().rotate(quat).translate(centroid)
			};
		};

		// even slots point apex-up (apex on the top ring), odd slots apex-down.
		const Tk = (k: number) => topV(k * step);
		const Vb = (k: number) => botV((k + 0.5) * step);

		if (twist > 0) {
			// Twisted: a raised mid on every ring edge turns each band triangle into a
			// quad and each pyramidal cap into m kite quads. tau is the azimuth offset
			// of the raised mids (the visible twist); their radius/height are solved
			// so both the band quad and the cap quad stay planar (see solveTwistMid).
			const tau = (step / 2) * twist;
			const Pt = new Vector3(0, y2 + capHeight, 0);
			const Pb = new Vector3(0, -(y2 + capHeight), 0);
			// The two ends are offset in opposite azimuth senses (+tau top, -tau bottom)
			// so the bottom mids are the C2-rotation (a horizontal 2-fold axis of the
			// antiprism) of the top mids. That C2 carries an apex-up face onto an
			// apex-down one, so all 2m band quads stay a single, identically-oriented
			// congruent shape (twisting both ends the same way mirrors them instead).
			const top = solveTwistMid(Pt, Tk(0), Vb(0), Tk(1), 0.5 * step + tau, -0.5 * step + tau);
			const bot = solveTwistMid(Pb, Vb(0), Tk(1), Vb(1), step - tau, -tau);
			const Mt = (k: number) => {
				const psi = (k + 0.5) * step + tau;
				return new Vector3(top.r * Math.sin(psi), top.y, top.r * Math.cos(psi));
			};
			const Mb = (k: number) => {
				const psi = (k + 1) * step - tau;
				return new Vector3(bot.r * Math.sin(psi), bot.y, bot.r * Math.cos(psi));
			};

			for (let j = 0; j < sides; j++) {
				const k = Math.floor(j / 2);
				const value = numberForSlot(j);
				if (j % 2 === 0) {
					// apex-up quad: apex T_k, base bottom edge with its raised mid.
					bandByValue[value - 1] = numberFace([Tk(k), Vb(k - 1), Mb(k - 1), Vb(k)], Tk(k), value);
				} else {
					// apex-down quad: apex V_k, base top edge with its raised mid.
					bandByValue[value - 1] = numberFace([Vb(k), Tk(k), Mt(k), Tk(k + 1)], Vb(k), value);
				}
			}

			// each cap kite wraps one ring vertex (the apex of the band face that owns
			// that vertex), spanning the two adjacent raised mids up to the cap tip.
			for (let k = 0; k < m; k++) {
				capByValue[numberForSlot(2 * k) - 1] = cap([Pt, Mt(k - 1), Tk(k), Mt(k)], Pt);
				capByValue[numberForSlot(2 * k + 1) - 1] = cap([Pb, Mb(k - 1), Vb(k), Mb(k)], Pb);
			}
		} else {
			// Plain: the 2m band triangles, plus (for m >= 3) two pyramidal caps of m
			// blank triangles. A top cap triangle shares its base edge with apex-down
			// band slot 2k+1; a bottom cap with apex-up slot 2k+2.
			for (let j = 0; j < sides; j++) {
				const k = Math.floor(j / 2);
				const value = numberForSlot(j);
				if (j % 2 === 0) {
					bandByValue[value - 1] = numberFace([Tk(k), Vb(k - 1), Vb(k)], Tk(k), value);
				} else {
					bandByValue[value - 1] = numberFace([Vb(k), Tk(k), Tk(k + 1)], Vb(k), value);
				}
			}
			if (m >= 3) {
				const Pt = new Vector3(0, y2 + capHeight, 0);
				const Pb = new Vector3(0, -(y2 + capHeight), 0);
				for (let k = 0; k < m; k++) {
					capByValue[numberForSlot((2 * k + 1) % sides) - 1] = cap([Pt, Tk(k), Tk(k + 1)], Pt);
					capByValue[numberForSlot((2 * k + 2) % sides) - 1] = cap([Pb, Vb(k + 1), Vb(k)], Pb);
				}
			}
		}

		const faces: Array<DieFaceModel> = [...bandByValue, ...capByValue.filter(Boolean)];

		// the inradius of the band (origin -> a number-face plane); used for the
		// reported face-to-face size.
		const face0 = faces[0];
		const n0 = new Vector3(0, 0, 1).applyQuaternion(face0.transform.rotation);
		const rho = Math.abs(face0.transform.translation.dot(n0));

		// print standing on a cap tip (or the ring end for the capless D4) —
		// the barrel is already built with its axis along Y.
		const printingTransform = liftOnlyPrintingTransform(faces);

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
