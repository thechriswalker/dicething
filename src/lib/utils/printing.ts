// Print orientation for export: by default rotate a vertex to point down (−Y),
// then raise so the lowest point sits PRINT_CLEARANCE_MM above the xz build
// plate. Blank caps (legend-free faces) are preferred over a sharper numbered
// tip. Some dice (cube d6, tetrahedral d4) instead rest on an edge.
import type { DieFaceModel } from '$lib/interfaces/dice';
import { Quaternion, Vector2, Vector3 } from 'three';
import { Transform } from './3d';
import { Legend } from './legends';

/** Gap between the lowest point of the die and the xz build plate (mm). */
export const PRINT_CLEARANCE_MM = 5;

const VERT_WELD_MM = 1e-3;
const OUTLINE_DIVISIONS = 12;
const _down = new Vector3(0, -1, 0);
const _up = new Vector3(0, 1, 0);

type VertRec = {
	position: Vector3;
	angleSum: number;
	faces: Set<number>;
	/** Unique incident outline edges, so shared edges are counted once. */
	edges: Set<string>;
};

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
 * Orient a die for printing, then lift so the tip clears the build plate by
 * `clearanceMm`.
 *
 * A vertex surrounded only by legend-free faces is preferred (the blank cap of
 * a shard): those are the faces that get supported, and their edges are the
 * short ones. Among such vertices the shortest incident edges win, then the
 * sharper tip. Every other die falls back to the sharpest corner (largest
 * angular defect, 2π − Σ face interior angles).
 */
export function computePointDownPrintingTransform(
	faces: Array<DieFaceModel>,
	clearanceMm = PRINT_CLEARANCE_MM
): Transform {
	const verts = new Map<string, VertRec>();
	const edgeLens = new Map<string, number>();

	for (let fi = 0; fi < faces.length; fi++) {
		const face = faces[fi];
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
			const nextWorld = face.transform.applyToVector3(new Vector3(next.x, next.y, 0));
			const k = weldKey(world);
			const nk = weldKey(nextWorld);
			let rec = verts.get(k);
			if (!rec) {
				rec = { position: world, angleSum: 0, faces: new Set(), edges: new Set() };
				verts.set(k, rec);
			}
			rec.angleSum += angle;
			rec.faces.add(fi);
			if (k !== nk) {
				const ek = k < nk ? `${k}|${nk}` : `${nk}|${k}`;
				rec.edges.add(ek);
				if (!edgeLens.has(ek)) edgeLens.set(ek, world.distanceTo(nextWorld));
			}
		}
	}

	if (verts.size === 0) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}

	const incidentLen = (rec: VertRec) => {
		let sum = 0;
		for (const ek of rec.edges) sum += edgeLens.get(ek) ?? 0;
		return sum;
	};
	const blankOnly = (rec: VertRec) => {
		let blank = 0;
		let legend = 0;
		for (const fi of rec.faces) {
			if (faces[fi].defaultLegend === Legend.BLANK) blank++;
			else legend++;
		}
		return legend === 0 && blank > 0;
	};

	const all = [...verts.values()];
	const caps = all.filter(blankOnly);
	let best: VertRec | undefined;
	if (caps.length > 0) {
		// Shorter edges first; a larger angular defect (smaller angle sum) breaks ties.
		caps.sort((a, b) => {
			const len = incidentLen(a) - incidentLen(b);
			if (Math.abs(len) > 1e-3) return len;
			return a.angleSum - b.angleSum;
		});
		best = caps[0];
	} else {
		let bestDefect = -Infinity;
		for (const rec of all) {
			const defect = 2 * Math.PI - rec.angleSum;
			if (defect > bestDefect) {
				bestDefect = defect;
				best = rec;
			}
		}
	}

	const centroid = new Vector3();
	for (const rec of all) centroid.add(rec.position);
	centroid.multiplyScalar(1 / all.length);

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

type WorldEdge = { a: Vector3; b: Vector3; len: number };

/**
 * Orient a die so one sharp edge lies on the build plate (horizontal, lowest),
 * with the body above it. Used for the cube d6 and tetrahedral d4s so only the
 * two faces meeting at that edge need supports (no tip-down apex post).
 */
export function computeEdgeDownPrintingTransform(
	faces: Array<DieFaceModel>,
	clearanceMm = PRINT_CLEARANCE_MM
): Transform {
	const edges = collectWorldEdges(faces);
	if (edges.length === 0) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}

	// Prefer a longest edge; ties break toward a deterministic endpoint key.
	edges.sort((u, v) => {
		if (Math.abs(v.len - u.len) > 1e-6) return v.len - u.len;
		const uk = `${weldKey(u.a)}|${weldKey(u.b)}`;
		const vk = `${weldKey(v.a)}|${weldKey(v.b)}`;
		return uk < vk ? -1 : uk > vk ? 1 : 0;
	});
	const edge = edges[0];

	const centroid = new Vector3();
	let nVerts = 0;
	const seen = new Set<string>();
	for (const face of faces) {
		if (face.hidden) continue;
		for (const p of outlinePoints(face)) {
			const w = face.transform.applyToVector3(new Vector3(p.x, p.y, 0));
			const k = weldKey(w);
			if (seen.has(k)) continue;
			seen.add(k);
			centroid.add(w);
			nVerts++;
		}
	}
	if (nVerts === 0) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}
	centroid.multiplyScalar(1 / nVerts);

	const mid = new Vector3().addVectors(edge.a, edge.b).multiplyScalar(0.5);
	const edgeDir = new Vector3().subVectors(edge.b, edge.a);
	if (edgeDir.lengthSq() < 1e-12) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}
	edgeDir.normalize();

	// From the edge toward the die centre, perpendicular to the edge — that
	// becomes +Y so the edge itself is the lowest feature.
	const toCentroid = new Vector3().subVectors(centroid, mid);
	const radial = toCentroid.addScaledVector(edgeDir, -toCentroid.dot(edgeDir));
	if (radial.lengthSq() < 1e-12) {
		return liftOnlyPrintingTransform(faces, clearanceMm);
	}
	radial.normalize();

	const qAlign = new Quaternion().setFromUnitVectors(radial, _up);
	const edgeHoriz = edgeDir.clone().applyQuaternion(qAlign);
	edgeHoriz.y = 0;
	let q = qAlign;
	if (edgeHoriz.lengthSq() > 1e-12) {
		edgeHoriz.normalize();
		// Yaw so the resting edge runs along +X (deterministic bed orientation).
		const yaw = Math.atan2(edgeHoriz.z, edgeHoriz.x);
		const qYaw = new Quaternion().setFromAxisAngle(_up, -yaw);
		q = qYaw.multiply(qAlign);
	}

	const minY = minYAfterRotation(faces, q);
	return new Transform().rotate(q).translateBy(0, clearanceMm - minY, 0);
}

/** Undirected outline edges in model space (hidden faces skipped). */
function collectWorldEdges(faces: Array<DieFaceModel>): Array<WorldEdge> {
	const edges = new Map<string, WorldEdge>();
	for (const face of faces) {
		if (face.hidden) continue;
		const pts = outlinePoints(face);
		if (pts.length < 2) continue;
		for (let i = 0; i < pts.length; i++) {
			const p0 = face.transform.applyToVector3(
				new Vector3(pts[i].x, pts[i].y, 0)
			);
			const p1 = face.transform.applyToVector3(
				new Vector3(pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y, 0)
			);
			const k0 = weldKey(p0);
			const k1 = weldKey(p1);
			if (k0 === k1) continue;
			const key = k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
			if (edges.has(key)) continue;
			edges.set(key, { a: p0, b: p1, len: p0.distanceTo(p1) });
		}
	}
	return [...edges.values()];
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
