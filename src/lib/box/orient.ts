// Build a closed solid for a die (no engraving) and lie it flat, ready to be
// subtracted from a box shell as a cavity.
//
// The box builder works entirely in a Z-up frame (so the printed box rests on
// the z = 0 plane, like a slicer expects). A die is laid so its chosen resting
// face is down on z = 0 and the body extends into +z, centred in x/y. The
// resting face is auto-picked from the geometry (the flattest stable lie),
// unless the model supplies a `boxTransform` override.

import type { DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Box3, BufferGeometry, Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import { shapeGeometry } from '$lib/utils/tessellate';
import { dieCenterOfMass } from '$lib/utils/stability';

// curve sampling for round-walled dice (barrels/coins). Faces of faceted dice
// are straight segments and ignore this.
const SOLID_DIVISIONS = 16;

const _up = new Vector3(0, 0, 1);
const _down = new Vector3(0, 0, -1);

// A closed (origin-centred, assembled-position) solid built straight from a
// die's face polygons. Each face's 2D shape is the boundary of one flat facet of
// the blank die, so triangulating every face and placing it by its transform
// reproduces the whole watertight surface - no engraving, no printing
// transform. Suitable as CSG input after a positional weld.
export function buildDieSolid(faces: Array<DieFaceModel>): BufferGeometry {
	const geos: Array<BufferGeometry> = [];
	for (const face of faces) {
		const cap = shapeGeometry(face.shape, SOLID_DIVISIONS);
		face.transform.applyToGeometry(cap);
		geos.push(cap);
	}
	if (geos.length === 0) {
		return new BufferGeometry();
	}
	return mergeGeometries(geos);
}

// Every distinct world-space vertex of the die (from its face shapes), used to
// measure the die's extent under a candidate resting face.
function dieVertices(faces: Array<DieFaceModel>): Array<Vector3> {
	const verts: Array<Vector3> = [];
	for (const face of faces) {
		for (const p of face.shape.getPoints(SOLID_DIVISIONS)) {
			verts.push(face.transform.applyToVector3(new Vector3(p.x, p.y, 0)));
		}
	}
	return verts;
}

// Is the die stable resting on `face`? The foot of the perpendicular from the
// centre of mass to the face plane must land inside the face polygon (the
// classic toppling test, mirroring stability.ts).
function faceIsRestable(face: DieFaceModel, com: Vector3): boolean {
	const inv = face.transform.rotation.clone().invert();
	const local = com.clone().sub(face.transform.translation).applyQuaternion(inv);
	const poly = face.shape.getPoints();
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const vi = poly[i];
		const vj = poly[j];
		const crosses =
			vi.y > local.y !== vj.y > local.y &&
			local.x < ((vj.x - vi.x) * (local.y - vi.y)) / (vj.y - vi.y) + vi.x;
		if (crosses) {
			inside = !inside;
		}
	}
	return inside;
}

// Rotation that brings a face's outward normal onto -Z, i.e. lays that face
// flat-down. The in-plane spin is arbitrary (resolved by setFromUnitVectors);
// the user can adjust it with a per-die rotation.
function restRotationForFace(face: DieFaceModel): Quaternion {
	const normal = _up.clone().applyQuaternion(face.transform.rotation).normalize();
	return new Quaternion().setFromUnitVectors(normal, _down);
}

// Pick the die's resting orientation. Honours a model `boxTransform` override;
// otherwise chooses the flattest stable face (smallest height above its plane),
// falling back to the flattest face overall if none are stable.
export function restRotation(model: DieModel, faces: Array<DieFaceModel>): Quaternion {
	if (model.boxTransform) {
		return model.boxTransform.rotation;
	}
	const verts = dieVertices(faces);
	const com = dieCenterOfMass(faces);

	let best: { q: Quaternion; height: number; restable: boolean } | undefined;
	for (const face of faces) {
		const normal = _up.clone().applyQuaternion(face.transform.rotation).normalize();
		const p = face.transform.translation;
		// extent of the die below this face's plane (how tall it stands when this
		// face is down).
		let height = 0;
		for (const v of verts) {
			const d = p.clone().sub(v).dot(normal);
			if (d > height) {
				height = d;
			}
		}
		const restable = faceIsRestable(face, com);
		const better =
			!best ||
			// prefer a stable lie; among same stability prefer the flattest.
			(restable && !best.restable) ||
			(restable === best.restable && height < best.height - 1e-6);
		if (better) {
			best = { q: restRotationForFace(face), height, restable };
		}
	}
	return best ? best.q : new Quaternion();
}

export type OrientedSolid = {
	// the die solid, laid flat on z = 0 and centred in x/y.
	geometry: BufferGeometry;
	// footprint + height (mm) in the laid-flat frame.
	size: Vector3;
};

// Build a die solid, orient it flat (resting face down, centred), and apply an
// extra in-plane rotation. `faces` should be the cavity ("bigger") faces when
// producing a cavity, or the true die faces for a preview of the die itself.
export function orientDieSolid(
	model: DieModel,
	faces: Array<DieFaceModel>,
	extraRotation = 0
): OrientedSolid {
	const geometry = buildDieSolid(faces);
	const q = restRotation(model, faces);
	if (extraRotation) {
		// extra spin about the vertical (Z) axis, applied after the rest rotation.
		q.premultiply(new Quaternion().setFromAxisAngle(_up, extraRotation));
	}
	geometry.applyMatrix4(new Matrix4().makeRotationFromQuaternion(q));

	geometry.computeBoundingBox();
	const bb = geometry.boundingBox ?? new Box3();
	const size = new Vector3();
	bb.getSize(size);
	// centre x/y on the origin and drop the lowest point onto z = 0.
	geometry.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
	return { geometry, size };
}

// 2D footprint helper (x,y) used by the layout engine.
export function footprint2D(size: Vector3): Vector2 {
	return new Vector2(size.x, size.y);
}
