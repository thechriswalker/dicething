// Print orientation for export: rotate the sharpest vertex to point down (−Y),
// then raise so the lowest point sits PRINT_CLEARANCE_MM above the xz build plate.
import type { DieFaceModel } from '$lib/interfaces/dice';
import { Quaternion, Vector2, Vector3 } from 'three';
import { Transform } from './3d';

/** Gap between the lowest point of the die and the xz build plate (mm). */
export const PRINT_CLEARANCE_MM = 5;

const VERT_WELD_MM = 1e-3;
const OUTLINE_DIVISIONS = 12;
const _down = new Vector3(0, -1, 0);

type VertRec = { position: Vector3; angleSum: number };

function weldKey(v: Vector3): string {
	const s = VERT_WELD_MM;
	return `${Math.round(v.x / s)}:${Math.round(v.y / s)}:${Math.round(v.z / s)}`;
}

function interiorAngle2d(prev: Vector2, curr: Vector2, next: Vector2): number {
	const ax = prev.x - curr.x;
	const ay = prev.y - curr.y;
	const bx = next.x - curr.x;
	const by = next.y - curr.y;
	const al = Math.hypot(ax, ay);
	const bl = Math.hypot(bx, by);
	if (al < 1e-12 || bl < 1e-12) {
		return 0;
	}
	return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (al * bl))));
}

function outlinePoints(face: DieFaceModel): Array<Vector2> {
	const pts = face.shape.getPoints(OUTLINE_DIVISIONS);
	if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-9) {
		return pts.slice(0, -1);
	}
	return pts;
}

/**
 * Orient a die for printing: sharpest corner (largest angular defect) points
 * down, then lift so the tip clears the build plate by `clearanceMm`.
 *
 * Angular defect at a vertex is 2π − Σ(face interior angles). Larger defect ⇒
 * sharper tip (tetrahedron > octahedron > cube).
 */
export function computePointDownPrintingTransform(
	faces: Array<DieFaceModel>,
	clearanceMm = PRINT_CLEARANCE_MM
): Transform {
	const verts = new Map<string, VertRec>();

	for (const face of faces) {
		// Hidden rim segments (coin) would flood the vertex set with near-flat
		// samples; sharpness is decided from the real facets only.
		if (face.hidden) {
			continue;
		}
		const pts = outlinePoints(face);
		if (pts.length < 3) {
			continue;
		}
		for (let i = 0; i < pts.length; i++) {
			const prev = pts[(i - 1 + pts.length) % pts.length];
			const curr = pts[i];
			const next = pts[(i + 1) % pts.length];
			const angle = interiorAngle2d(prev, curr, next);
			const world = face.transform.applyToVector3(new Vector3(curr.x, curr.y, 0));
			const k = weldKey(world);
			const rec = verts.get(k);
			if (rec) {
				rec.angleSum += angle;
			} else {
				verts.set(k, { position: world, angleSum: angle });
			}
		}
	}

	if (verts.size === 0) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}

	let best: VertRec | undefined;
	let bestDefect = -Infinity;
	const centroid = new Vector3();
	for (const rec of verts.values()) {
		centroid.add(rec.position);
		const defect = 2 * Math.PI - rec.angleSum;
		if (defect > bestDefect) {
			bestDefect = defect;
			best = rec;
		}
	}
	centroid.multiplyScalar(1 / verts.size);

	if (!best) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}

	const tipDir = best.position.clone().sub(centroid);
	if (tipDir.lengthSq() < 1e-12) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}
	tipDir.normalize();
	const q = new Quaternion().setFromUnitVectors(tipDir, _down);
	const minY = minYAfterRotation(faces, q);
	return new Transform().rotate(q).translateBy(0, clearanceMm - minY, 0);
}

/** Raise an already-oriented die so its lowest point is `clearanceMm` above y = 0. */
export function liftOnlyPrintingTransform(
	faces: Array<DieFaceModel>,
	clearanceMm = PRINT_CLEARANCE_MM
): Transform {
	const minY = minYAfterRotation(faces, new Quaternion());
	return new Transform().translateBy(0, clearanceMm - minY, 0);
}

/**
 * Stand a flat (XY-plane) die on an outline vertex: rotate about Z so the
 * chosen vertex points −Y, then lift. Picks the furthest-from-centroid outline
 * point (a polygon corner / custom tip); ties break toward the sharper corner.
 * Used by the coin so non-circular and custom outlines don't rest on a flat edge.
 */
export function computeOutlineVertexDownPrintingTransform(
	outline: Array<Vector2>,
	faces: Array<DieFaceModel>,
	clearanceMm = PRINT_CLEARANCE_MM
): Transform {
	if (outline.length < 3) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}
	const n = outline.length;
	const centroid = new Vector2();
	for (const p of outline) {
		centroid.add(p);
	}
	centroid.multiplyScalar(1 / n);

	let bestI = 0;
	let bestRadius = -Infinity;
	let bestDefect = -Infinity;
	for (let i = 0; i < n; i++) {
		const prev = outline[(i - 1 + n) % n];
		const curr = outline[i];
		const next = outline[(i + 1) % n];
		const radius = curr.distanceTo(centroid);
		const defect = Math.PI - interiorAngle2d(prev, curr, next);
		if (radius > bestRadius + 1e-9 || (Math.abs(radius - bestRadius) <= 1e-9 && defect > bestDefect)) {
			bestRadius = radius;
			bestDefect = defect;
			bestI = i;
		}
	}

	const tip = outline[bestI].clone().sub(centroid);
	if (tip.lengthSq() < 1e-12) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}
	// rotate in-plane so the tip lands on −Y.
	const delta = -Math.PI / 2 - Math.atan2(tip.y, tip.x);
	const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), delta);
	const minY = minYAfterRotation(faces, q);
	return new Transform().rotate(q).translateBy(0, clearanceMm - minY, 0);
}

function minYAfterRotation(faces: Array<DieFaceModel>, q: Quaternion): number {
	let minY = Infinity;
	for (const face of faces) {
		for (const p of outlinePoints(face)) {
			const v = face.transform.applyToVector3(new Vector3(p.x, p.y, 0));
			v.applyQuaternion(q);
			if (v.y < minY) {
				minY = v.y;
			}
		}
	}
	return Number.isFinite(minY) ? minY : 0;
}
