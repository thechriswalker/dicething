// Static-stability ("won't land wrong") check for dice.
//
// Some die shapes have faces they should never come to rest on, because doing so
// leaves an ambiguous result face-up: a crystal whose blank caps are too tall can
// topple onto a cap; an odd prism is only fair if it can't settle on a numbered
// end; the truncated d4/d8 deliberately trade rollability for an occasional rest
// on an inconclusive face. Models mark those faces with `noRest` (see
// DieFaceModel) and this module decides whether the built geometry can actually
// rest on any of them.
//
// The physics is the classic toppling/support test: a body placed on a face is in
// stable equilibrium only if the perpendicular dropped from its centre of mass to
// that face's plane lands inside the face's support polygon. If it lands outside,
// gravity's torque rolls the die off onto a neighbouring face. So a flagged face
// is "restable" exactly when that foot-of-perpendicular falls within the face -
// which is what the user described as "the line from the centre of gravity to the
// plane of the face is within the convex hull boundary of the face".

import type { DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Vector2, Vector3 } from 'three';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _cross = new Vector3();

// Centre of mass of the (uniform-density) solid described by `faces`. Every die
// here is built star-shaped about the origin, so the solid is the union of the
// tetrahedra from the origin out to each face triangle; the COM is the
// volume-weighted average of those tetrahedra's centroids.
//
// The raw 2D face shapes are not wound consistently outward (opposite faces can
// run in opposite senses), so the signed tetra volume can come out negative for a
// whole face. Within ONE planar face the sign is consistent (the origin sits on a
// single side of the plane), so we sum each face on its own and flip a negative
// face's contribution - mirroring approximateDieVolume()'s per-face abs.
export function dieCenterOfMass(faces: Array<DieFaceModel>): Vector3 {
	let totalV6 = 0;
	const com = new Vector3();
	for (const face of faces) {
		const pts = face.shape.getPoints();
		if (pts.length < 3) {
			continue;
		}
		const world = pts.map((p) => face.transform.applyToVector3(new Vector3(p.x, p.y, 0)));
		let faceV6 = 0;
		const faceCom = new Vector3();
		for (let i = 1; i < world.length - 1; i++) {
			_a.copy(world[0]);
			_b.copy(world[i]);
			_c.copy(world[i + 1]);
			// six times the signed volume of the tetrahedron (origin, a, b, c).
			const v6 = _a.dot(_cross.crossVectors(_b, _c));
			faceV6 += v6;
			// the tetra centroid is (origin + a + b + c) / 4, weighted by its volume.
			faceCom.addScaledVector(_a.clone().add(_b).add(_c), v6 / 4);
		}
		if (faceV6 < 0) {
			faceV6 = -faceV6;
			faceCom.negate();
		}
		totalV6 += faceV6;
		com.add(faceCom);
	}
	if (totalV6 === 0) {
		return new Vector3();
	}
	return com.multiplyScalar(1 / totalV6);
}

// even-odd ray cast: is (x, y) inside the polygon `poly`? `poly` is an open loop.
// the flagged faces are all convex, so this is equivalent to the convex-hull test
// the warning is defined against, while staying correct for any face shape.
function pointInPolygon(x: number, y: number, poly: Array<Vector2>): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const vi = poly[i];
		const vj = poly[j];
		const crosses =
			vi.y > y !== vj.y > y && x < ((vj.x - vi.x) * (y - vi.y)) / (vj.y - vi.y) + vi.x;
		if (crosses) {
			inside = !inside;
		}
	}
	return inside;
}

// Can the die rest on `face` given its centre of mass `com`? We move the COM into
// the face's local frame (where the face lies on z = 0 with +z its outward
// normal); the foot of the perpendicular is then just (x, y), and the die can
// balance there iff that point lies within the face polygon.
function faceIsRestable(face: DieFaceModel, com: Vector3): boolean {
	const inv = face.transform.rotation.invert();
	const local = com.clone().sub(face.transform.translation).applyQuaternion(inv);
	const poly = face.shape.getPoints();
	return pointInPolygon(local.x, local.y, poly);
}

// Indices of every `noRest` face the die can actually come to rest on. Empty when
// the die has no flagged faces, or none of them are reachable for the current
// parameters (e.g. a crystal with small enough caps).
export function restableNoRestFaces(faces: Array<DieFaceModel>): Array<number> {
	if (!faces.some((f) => f.noRest)) {
		return [];
	}
	const com = dieCenterOfMass(faces);
	const indices: Array<number> = [];
	for (let i = 0; i < faces.length; i++) {
		if (faces[i].noRest && faceIsRestable(faces[i], com)) {
			indices.push(i);
		}
	}
	return indices;
}

// Whether the die warrants a "may land on an inconclusive face" warning: true
// when at least one `noRest` face is restable. The accompanying message is
// localised per model id (see m.dice_land_warning) so each die can explain
// whether this is a defect to fix or an expected trade-off.
export function dieHasLandWarning(faces: Array<DieFaceModel>): boolean {
	return restableNoRestFaces(faces).length > 0;
}

// Build a die in isolation (no scene) purely to decide whether it needs the
// land-warning. Mirrors computeEngravingErrors(); the result depends only on the
// die parameters (the geometry), not on legends or per-face params.
export function computeLandWarning(
	model: DieModel,
	params: Record<string, number>,
	stringParams: Record<string, string> = {}
): boolean {
	try {
		return dieHasLandWarning(model.build(params, stringParams).faces);
	} catch (e) {
		console.warn('failed to compute land warning', e);
		return false;
	}
}
