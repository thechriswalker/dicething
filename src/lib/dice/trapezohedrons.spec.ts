import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { RhombicD6, TrapezohedronD8, TrapezohedronD10 } from './trapezohedrons';
import type { Transform } from '$lib/utils/3d';

/** Recover a face's 3D vertices from its 2D shape + transform. */
function faceVerts3(shape: { getPoints(): Array<{ x: number; y: number }> }, transform: Transform) {
	return shape.getPoints().map((p) => transform.applyToVector3(new Vector3(p.x, p.y, 0)));
}

describe('trapezohedron sizing', () => {
	it('d10 radius is the axial distance to each kite outer vertex', () => {
		const axialR = 13;
		const height = 26;
		const built = TrapezohedronD10.build({
			trapezohedron_radius: axialR,
			trapezohedron_height: height
		});
		const face = built.faces[0];
		const verts = faceVerts3(face.shape, face.transform);
		// drop near-duplicate closing point if present
		const unique = verts.filter(
			(v, i, arr) => i === 0 || v.distanceToSquared(arr[i - 1]) > 1e-12
		);
		const offAxis = unique.filter((v) => Math.hypot(v.x, v.z) > 1e-6);
		expect(offAxis.length).toBe(3);
		for (const v of offAxis) {
			expect(Math.hypot(v.x, v.z)).toBeCloseTo(axialR, 6);
		}
	});

	it('face-to-face is twice the plane distance, not the centroid length', () => {
		const built = TrapezohedronD10.build({
			trapezohedron_radius: 16,
			trapezohedron_height: 28
		});
		const face = built.faces[0];
		const verts = faceVerts3(face.shape, face.transform);
		const a = verts[0];
		const b = verts[1];
		const c = verts[2];
		const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
		const planeDist = Math.abs(normal.dot(a));
		expect(built.faceToFaceDistance).toBeCloseTo(planeDist * 2, 6);
		// centroid length would disagree on kite faces
		const centroid = verts
			.slice(0, 4)
			.reduce((acc, v) => acc.add(v), new Vector3())
			.multiplyScalar(0.25);
		expect(Math.abs(built.faceToFaceDistance - centroid.length() * 2)).toBeGreaterThan(0.5);
	});

	it('untwisted d8 radius still lands equator vertices on the parameter', () => {
		const r = 16;
		const built = TrapezohedronD8.build({ trapezohedron_radius: r, trapezohedron_height: 28 });
		const face = built.faces[0];
		const verts = faceVerts3(face.shape, face.transform);
		const equator = verts.filter((v) => Math.abs(v.y) < 1e-6);
		expect(equator.length).toBeGreaterThanOrEqual(2);
		for (const v of equator) {
			expect(Math.hypot(v.x, v.z)).toBeCloseTo(r, 6);
		}
	});

	it('rhombic d6 (twisted) also uses axial kite radius', () => {
		const axialR = 10;
		const built = RhombicD6.build({ trapezohedron_radius: axialR, trapezohedron_height: 20 });
		const face = built.faces[0];
		const verts = faceVerts3(face.shape, face.transform);
		const offAxis = verts.filter((v) => Math.hypot(v.x, v.z) > 1e-6);
		for (const v of offAxis) {
			expect(Math.hypot(v.x, v.z)).toBeCloseTo(axialR, 6);
		}
	});
});
