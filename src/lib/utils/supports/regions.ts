// Support region detection: sharp-edge lines (deterministic from the face list)
// and legend contour points (local-Y weakness anchors + even spacing between them).
//
// All coordinates are in print space: Y-up, build plate on the xz plane at y = 0,
// after the die's printingTransform has been applied.

import type { DieFaceModel, FaceParams } from '$lib/interfaces/dice';
import { Shape, ShapeUtils, Vector2, Vector3 } from 'three';
import type { Transform } from '../3d';
import { DefaultDivisions } from '../engraving';
import { Legend, type LegendSet } from '../legends';
import { rotateShapes, scaleShapes, translateShapes } from '../shapes';
import {
	assertNotCancelled,
	DEFAULT_SUPPORT_SETTINGS,
	type SupportCancelToken,
	type SupportEdgeLine,
	type SupportLegendPoint,
	type SupportProgressFn,
	type SupportRegions,
	type SupportSettings,
	type SupportTipPost
} from './types';

const VERT_WELD_MM = 1e-3;
const OUTLINE_DIVISIONS = 12;
const SHARP_NORMAL_DOT = Math.cos((20 * Math.PI) / 180); // normals differ by > ~20°
/**
 * Face outward-normal Y below this ⇒ the face slopes outward under tip-down
 * printing (underside overhang) and needs edge/legend supports. Vertical faces
 * (|n.y| small) and inward/upward faces (n.y positive) do not.
 */
/** Outward lean above this (degrees) still counts for legend supports. */
const LEGEND_OUTWARD_MIN_DEG = 0.5;

type WeldVert = { position: Vector3; key: string };

type EdgeFaceRef = {
	faceIndex: number;
	/** Index of the start vertex on the face outline. */
	edgeStart: number;
};

type SharpEdge = {
	a: Vector3;
	b: Vector3;
	faces: Array<EdgeFaceRef>;
};

function weldKey(v: Vector3): string {
	const s = VERT_WELD_MM;
	return `${Math.round(v.x / s)}:${Math.round(v.y / s)}:${Math.round(v.z / s)}`;
}

function outlinePoints2d(face: DieFaceModel): Array<Vector2> {
	const pts = face.shape.getPoints(OUTLINE_DIVISIONS);
	if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-9) {
		return pts.slice(0, -1);
	}
	return pts;
}

/** Outward face normal in print space. */
export function faceNormalPrint(face: DieFaceModel, printingTransform: Transform): Vector3 {
	const o = face.transform.applyToVector3(new Vector3(0, 0, 0));
	const tip = face.transform.applyToVector3(new Vector3(0, 0, 1));
	const n = tip.sub(o).normalize();
	return n.applyQuaternion(printingTransform.rotation);
}

/** World/print position of a face-local point. */
export function facePointPrint(
	face: DieFaceModel,
	local: Vector2,
	printingTransform: Transform
): Vector3 {
	const w = face.transform.applyToVector3(new Vector3(local.x, local.y, 0));
	return printingTransform.applyToVector3(w);
}

/**
 * Project a print-space point onto a face's local 2D frame (least-squares on the
 * face plane). Used to test whether support contacts fall in engraved fill.
 */
export function printPointToFaceLocal(
	face: DieFaceModel,
	printPoint: Vector3,
	printingTransform: Transform
): Vector2 | undefined {
	const origin = facePointPrint(face, new Vector2(0, 0), printingTransform);
	const ax = facePointPrint(face, new Vector2(1, 0), printingTransform).sub(origin);
	const ay = facePointPrint(face, new Vector2(0, 1), printingTransform).sub(origin);
	const d = printPoint.clone().sub(origin);
	const a00 = ax.dot(ax);
	const a01 = ax.dot(ay);
	const a11 = ay.dot(ay);
	const det = a00 * a11 - a01 * a01;
	if (Math.abs(det) < 1e-14) return undefined;
	const b0 = d.dot(ax);
	const b1 = d.dot(ay);
	return new Vector2((a11 * b0 - a01 * b1) / det, (a00 * b1 - a01 * b0) / det);
}

function faceCentroidPrint(face: DieFaceModel, printingTransform: Transform): Vector3 {
	const pts = outlinePoints2d(face);
	const c = new Vector2();
	for (const p of pts) {
		c.add(p);
	}
	if (pts.length > 0) {
		c.multiplyScalar(1 / pts.length);
	}
	return facePointPrint(face, c, printingTransform);
}

/**
 * Build undirected sharp edges from the face list (including hidden faces so
 * coin rim boundaries exist), in print space.
 */
export function collectSharpEdges(
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform
): Array<SharpEdge> {
	const verts = new Map<string, WeldVert>();
	// edgeKey -> face refs
	const edgeMap = new Map<string, { a: Vector3; b: Vector3; faces: Array<EdgeFaceRef> }>();

	const ensureVert = (p: Vector3): WeldVert => {
		const key = weldKey(p);
		let v = verts.get(key);
		if (!v) {
			v = { position: p.clone(), key };
			verts.set(key, v);
		}
		return v;
	};

	for (let fi = 0; fi < faces.length; fi++) {
		const face = faces[fi];
		const pts = outlinePoints2d(face);
		if (pts.length < 3) continue;
		const world = pts.map((p) => {
			const w = facePointPrint(face, p, printingTransform);
			return ensureVert(w);
		});
		for (let i = 0; i < world.length; i++) {
			const a = world[i];
			const b = world[(i + 1) % world.length];
			if (a.key === b.key) continue;
			const edgeKey = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
			let rec = edgeMap.get(edgeKey);
			if (!rec) {
				rec = { a: a.position, b: b.position, faces: [] };
				edgeMap.set(edgeKey, rec);
			}
			rec.faces.push({ faceIndex: fi, edgeStart: i });
		}
	}

	const normals = faces.map((f) => faceNormalPrint(f, printingTransform));
	const sharp: Array<SharpEdge> = [];
	for (const rec of edgeMap.values()) {
		if (rec.faces.length < 2) continue;
		// Use the first two distinct face normals.
		const seen = new Set<number>();
		const pair: number[] = [];
		for (const fr of rec.faces) {
			if (seen.has(fr.faceIndex)) continue;
			seen.add(fr.faceIndex);
			pair.push(fr.faceIndex);
			if (pair.length === 2) break;
		}
		if (pair.length < 2) continue;
		const dot = Math.abs(normals[pair[0]].dot(normals[pair[1]]));
		if (dot > SHARP_NORMAL_DOT) continue; // near-coplanar
		sharp.push({ a: rec.a, b: rec.b, faces: rec.faces });
	}
	return sharp;
}

/**
 * Angle of a face from vertical, in degrees. 0 = vertical (normal horizontal).
 * Positive = outward lean (underside overhang). Negative = inward / upward.
 */
export function faceAngleFromVerticalDeg(normal: Vector3): number {
	const horiz = Math.hypot(normal.x, normal.z);
	return (Math.atan2(-normal.y, horiz) * 180) / Math.PI;
}

/** Any real outward lean — legend supports still apply on near-vertical faces. */
export function faceSlopesOutward(normal: Vector3): boolean {
	return faceAngleFromVerticalDeg(normal) > LEGEND_OUTWARD_MIN_DEG;
}

/** Face is steep enough to receive edge supports at this cutoff. */
export function faceNeedsEdgeSupports(normal: Vector3, minAngleDeg: number): boolean {
	return faceAngleFromVerticalDeg(normal) >= minAngleDeg;
}

/** Truly vertical face (cube sides), not merely below the edge-support cutoff. */
export function faceIsVertical(normal: Vector3): boolean {
	return Math.abs(faceAngleFromVerticalDeg(normal)) <= 2;
}

/**
 * Distinct adjacent faces of a sharp edge that slope outward under tip-down
 * printing. An edge only needs supports when at least two outward faces meet
 * (the crease between them) — e.g. the long edges of a d10's lower kite faces.
 */
export function outwardFacesAtEdge(
	faces: ReadonlyArray<DieFaceModel>,
	edgeFaces: ReadonlyArray<{ faceIndex: number }>,
	printingTransform: Transform,
	minAngleDeg = DEFAULT_SUPPORT_SETTINGS.faceMinAngleDeg
): Array<{ faceIndex: number; normal: Vector3 }> {
	const seen = new Set<number>();
	const out: Array<{ faceIndex: number; normal: Vector3 }> = [];
	for (const fr of edgeFaces) {
		if (seen.has(fr.faceIndex)) continue;
		seen.add(fr.faceIndex);
		const normal = faceNormalPrint(faces[fr.faceIndex], printingTransform);
		if (!faceNeedsEdgeSupports(normal, minAngleDeg)) continue;
		out.push({ faceIndex: fr.faceIndex, normal });
	}
	return out;
}

/** A neighbour within the cutoff of vertical (outward or inward), not a steep overhang. */
function edgeHasNearVerticalFace(
	faces: ReadonlyArray<DieFaceModel>,
	edgeFaces: ReadonlyArray<{ faceIndex: number }>,
	printingTransform: Transform,
	minAngleDeg: number
): boolean {
	const seen = new Set<number>();
	for (const fr of edgeFaces) {
		if (seen.has(fr.faceIndex)) continue;
		seen.add(fr.faceIndex);
		const angle = faceAngleFromVerticalDeg(faceNormalPrint(faces[fr.faceIndex], printingTransform));
		if (Math.abs(angle) < minAngleDeg) return true;
	}
	return false;
}

/** True when any face at the edge is vertical in print space. */
export function edgeHasVerticalFace(
	faces: ReadonlyArray<DieFaceModel>,
	edgeFaces: ReadonlyArray<{ faceIndex: number }>,
	printingTransform: Transform
): boolean {
	const seen = new Set<number>();
	for (const fr of edgeFaces) {
		if (seen.has(fr.faceIndex)) continue;
		seen.add(fr.faceIndex);
		const normal = faceNormalPrint(faces[fr.faceIndex], printingTransform);
		if (faceIsVertical(normal)) return true;
	}
	return false;
}

/**
 * Full sharp-edge segment in print space. Selection of which edges/faces get
 * supports is done via {@link outwardFacesAtEdge} in {@link computeEdgeSupportLines}.
 */
export function supportEdgeSegment(
	a: Vector3,
	b: Vector3,
	_minY?: number,
	_maxY?: number
): [Vector3, Vector3] | undefined {
	if (a.distanceToSquared(b) < 1e-12) {
		return undefined;
	}
	return [a.clone(), b.clone()];
}

/** @deprecated use {@link supportEdgeSegment} */
export const lowerHalfSegment = supportEdgeSegment;

/**
 * Offset a print-space edge segment onto a face by `insetMm` along the face,
 * so the contact sits on the flat rather than on the sharp edge.
 */
export function insetSegmentOntoFace(
	a: Vector3,
	b: Vector3,
	face: DieFaceModel,
	printingTransform: Transform,
	insetMm: number
): [Vector3, Vector3] | undefined {
	const n = faceNormalPrint(face, printingTransform);
	const d = new Vector3().subVectors(b, a);
	const len = d.length();
	if (len < 1e-9) return undefined;
	d.multiplyScalar(1 / len);

	// In-plane direction perpendicular to the edge.
	let inward = new Vector3().crossVectors(d, n);
	if (inward.lengthSq() < 1e-12) {
		inward = new Vector3().crossVectors(n, new Vector3(0, 1, 0));
	}
	if (inward.lengthSq() < 1e-12) {
		inward = new Vector3().crossVectors(n, new Vector3(1, 0, 0));
	}
	inward.normalize();

	const centroid = faceCentroidPrint(face, printingTransform);
	const toCentroid = new Vector3().subVectors(centroid, a);
	if (toCentroid.dot(inward) < 0) {
		inward.negate();
	}

	const off = inward.multiplyScalar(insetMm);
	return [a.clone().add(off), b.clone().add(off)];
}

/** Face-inset distance for edge contacts (user "edge distance" setting). */
export function edgeInsetForSphere(settings: SupportSettings): number {
	return Math.max(0, settings.edgeInsetMm);
}

/**
 * Pull both ends of a segment back by `trimMm` along its length. Used so edge
 * support centres stop short of corners by the same distance as the inset from
 * the supported edge. Sphere overflow past an adjoining edge is handled
 * separately by {@link clipSupportLineForSphere}: that clearance depends on
 * the corner angle, not on the along-line inset.
 * Returns undefined when the edge is too short to keep that clearance.
 */
export function trimSegmentEnds(
	a: Vector3,
	b: Vector3,
	trimMm: number
): [Vector3, Vector3] | undefined {
	const d = new Vector3().subVectors(b, a);
	const len = d.length();
	if (len < 2 * trimMm + 1e-6) {
		return undefined;
	}
	d.multiplyScalar(1 / len);
	return [a.clone().addScaledVector(d, trimMm), b.clone().addScaledVector(d, -trimMm)];
}

/** Distance from `p` to the finite segment `a`–`b`. */
function distanceToSegment(p: Vector3, a: Vector3, b: Vector3): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const lenSq = abx * abx + aby * aby + abz * abz;
	if (lenSq < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
	let t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq;
	if (t < 0) t = 0;
	else if (t > 1) t = 1;
	return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

/** Perpendicular distance from `p` to the infinite line through `a`–`b`. */
function distanceToLine(p: Vector3, a: Vector3, b: Vector3): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const len = Math.hypot(abx, aby, abz);
	if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
	const apx = p.x - a.x;
	const apy = p.y - a.y;
	const apz = p.z - a.z;
	const cx = apy * abz - apz * aby;
	const cy = apz * abx - apx * abz;
	const cz = apx * aby - apy * abx;
	return Math.hypot(cx, cy, cz) / len;
}

type FacePlane = { point: Vector3; normal: Vector3; face?: DieFaceModel };

/** Signed distance to a plane. Positive is on the outward-normal side. */
function signedPlaneDistance(p: Vector3, plane: FacePlane): number {
	return (
		(p.x - plane.point.x) * plane.normal.x +
		(p.y - plane.point.y) * plane.normal.y +
		(p.z - plane.point.z) * plane.normal.z
	);
}

/**
 * Planes that actually close in on the run. The host face and anything parallel
 * to it sit at a constant distance. Facets of the same smooth surface (a curve
 * chopped into chords) are nearly parallel to the host normal and are the
 * surface the contact sits on, not a wall it is exiting through.
 */
function varyingPlanes(
	a: Vector3,
	b: Vector3,
	planes: ReadonlyArray<FacePlane>,
	hostNormal?: Vector3
): Array<FacePlane> {
	const parallelDot = Math.cos((30 * Math.PI) / 180);
	return planes.filter((plane) => {
		if (hostNormal && Math.abs(hostNormal.dot(plane.normal)) > parallelDot) return false;
		const d0 = signedPlaneDistance(a, plane);
		const d1 = signedPlaneDistance(b, plane);
		if (Math.abs(d0 - d1) <= 0.05) return false;
		return Math.abs((d0 + d1) / 2) > 0.02;
	});
}

/**
 * A sphere centred at `p` does not pass through this face.
 *
 * Inside the half-space by a full radius is always clear. Inside by less than
 * that still crosses the plane, which is how a tip sphere exits the next face
 * of a convex die. Outside the half-space is different: a concave outline (the
 * custom coin) has face planes whose outward side covers most of the die, so
 * a positive distance only matters when the sphere actually meets that face's
 * polygon.
 */
function sphereClearsPlane(
	p: Vector3,
	plane: FacePlane,
	radiusMm: number,
	printingTransform?: Transform
): boolean {
	const s = signedPlaneDistance(p, plane);
	if (s <= -radiusMm) return true;
	if (s <= 0 || !plane.face || !printingTransform) return false;
	if (s >= radiusMm) return true;
	const local = printPointToFaceLocal(plane.face, p, printingTransform);
	if (!local) return false;
	const diskR = Math.sqrt(Math.max(0, radiusMm * radiusMm - s * s));
	const outline = openLoop2d(plane.face.shape.getPoints(OUTLINE_DIVISIONS));
	return !inExpandedHull(local, outline, diskR);
}

/**
 * Shorten a support run so a sphere of `radiusMm` centred on it stays off
 * adjoining edges and does not pass through any other face. The edge the run
 * follows, and the face it lies on, sit at a constant distance and are left
 * alone. Ends move only along the run.
 * Returns undefined when no point on the run can host the sphere.
 */
export function clipSupportLineForSphere(
	a: Vector3,
	b: Vector3,
	obstacles: ReadonlyArray<{ a: Vector3; b: Vector3 }>,
	radiusMm: number,
	planes: ReadonlyArray<FacePlane> = [],
	printingTransform?: Transform,
	hostNormal?: Vector3
): [Vector3, Vector3] | undefined {
	if (radiusMm <= 1e-6) return [a, b];
	const len = a.distanceTo(b);
	if (len < 1e-6) return undefined;

	// Parallel edges (the followed crease, and an opposite edge of a rectangle)
	// sit at a constant distance. Adjoining edges do not.
	const active = obstacles.filter((o) => {
		const d0 = distanceToLine(a, o.a, o.b);
		const d1 = distanceToLine(b, o.a, o.b);
		return Math.abs(d0 - d1) > 0.02;
	});
	const activePlanes = varyingPlanes(a, b, planes, hostNormal);
	if (active.length === 0 && activePlanes.length === 0) return [a, b];

	const clear = (p: Vector3) => {
		for (const o of active) {
			if (distanceToSegment(p, o.a, o.b) < radiusMm) return false;
		}
		for (const plane of activePlanes) {
			if (!sphereClearsPlane(p, plane, radiusMm, printingTransform)) return false;
		}
		return true;
	};

	const pull = (end: Vector3, other: Vector3): Vector3 | undefined => {
		if (clear(end)) return end;
		let lo = 0;
		let hi = 1;
		let seenClear = false;
		const probe = new Vector3();
		for (let i = 0; i < 20; i++) {
			const t = (lo + hi) / 2;
			probe.lerpVectors(end, other, t);
			if (clear(probe)) {
				seenClear = true;
				hi = t;
			} else {
				lo = t;
			}
		}
		if (!seenClear) return undefined;
		return new Vector3().lerpVectors(end, other, hi);
	};

	const a2 = pull(a, b);
	const b2 = pull(b, a);
	if (!a2 || !b2) return undefined;
	if (new Vector3().subVectors(b2, a2).dot(new Vector3().subVectors(b, a)) <= 1e-8) {
		return undefined;
	}
	if (a2.distanceTo(b2) < 1e-3) return undefined;
	return [a2, b2];
}

function polylineArcLength(pts: ReadonlyArray<Vector3>): number {
	let s = 0;
	for (let i = 1; i < pts.length; i++) s += pts[i - 1].distanceTo(pts[i]);
	return s;
}

function pointAtArc(pts: ReadonlyArray<Vector3>, dist: number): Vector3 {
	if (pts.length === 0) return new Vector3();
	if (dist <= 0) return pts[0].clone();
	let s = 0;
	for (let i = 1; i < pts.length; i++) {
		const seg = pts[i - 1].distanceTo(pts[i]);
		if (s + seg >= dist - 1e-9) {
			const t = seg > 1e-9 ? (dist - s) / seg : 0;
			return new Vector3().lerpVectors(pts[i - 1], pts[i], Math.min(1, Math.max(0, t)));
		}
		s += seg;
	}
	return pts[pts.length - 1].clone();
}

/** Sub-polyline covering arc length `[s0, s1]`. */
function slicePolyline(pts: ReadonlyArray<Vector3>, s0: number, s1: number): Array<Vector3> {
	if (pts.length === 0 || s1 - s0 < 1e-4) return [];
	const out: Array<Vector3> = [pointAtArc(pts, s0)];
	let s = 0;
	for (let i = 1; i < pts.length; i++) {
		s += pts[i - 1].distanceTo(pts[i]);
		if (s > s0 + 1e-3 && s < s1 - 1e-3) out.push(pts[i].clone());
	}
	out.push(pointAtArc(pts, s1));
	const compact: Array<Vector3> = [];
	for (const p of out) {
		if (compact.length === 0 || compact[compact.length - 1].distanceTo(p) > 1e-3) {
			compact.push(p);
		}
	}
	return compact;
}

/**
 * Pull both ends of a polyline back along its length. A curve shorter than
 * the full trim keeps a middle span instead of disappearing.
 */
function trimPolylineEnds(pts: ReadonlyArray<Vector3>, trimMm: number): Array<Vector3> | undefined {
	const total = polylineArcLength(pts);
	if (total < 0.4) return undefined;
	const trim = Math.min(Math.max(0, trimMm), total * 0.25);
	if (total - 2 * trim < 0.3) return undefined;
	const sliced = slicePolyline(pts, trim, total - trim);
	return sliced.length >= 2 ? sliced : undefined;
}

/**
 * Same clearance as {@link clipSupportLineForSphere}, walking a curve so the
 * ends move along the polyline rather than across its chord.
 */
function clipPolylineForSphere(
	pts: ReadonlyArray<Vector3>,
	obstacles: ReadonlyArray<{ a: Vector3; b: Vector3 }>,
	radiusMm: number,
	planes: ReadonlyArray<FacePlane>,
	hostNormal: Vector3,
	printingTransform?: Transform
): Array<Vector3> | undefined {
	if (pts.length < 2) return undefined;
	if (radiusMm <= 1e-6) return pts.map((p) => p.clone());
	const a = pts[0];
	const b = pts[pts.length - 1];
	const total = polylineArcLength(pts);
	if (total < 0.3) return undefined;
	const active = obstacles.filter((o) => {
		const d0 = distanceToLine(a, o.a, o.b);
		const d1 = distanceToLine(b, o.a, o.b);
		return Math.abs(d0 - d1) > 0.02;
	});
	const activePlanes = varyingPlanes(a, b, planes, hostNormal);
	if (active.length === 0 && activePlanes.length === 0) return pts.map((p) => p.clone());
	const clear = (p: Vector3) => {
		for (const o of active) {
			if (distanceToSegment(p, o.a, o.b) < radiusMm) return false;
		}
		for (const plane of activePlanes) {
			if (!sphereClearsPlane(p, plane, radiusMm, printingTransform)) return false;
		}
		return true;
	};
	const pull = (fromEnd: boolean): number | undefined => {
		const endS = fromEnd ? 0 : total;
		if (clear(pointAtArc(pts, endS))) return endS;
		let lo = 0;
		let hi = 1;
		let seen = false;
		for (let i = 0; i < 20; i++) {
			const t = (lo + hi) / 2;
			const s = fromEnd ? t * (total / 2) : total - t * (total / 2);
			if (clear(pointAtArc(pts, s))) {
				seen = true;
				hi = t;
			} else {
				lo = t;
			}
		}
		if (!seen) return undefined;
		return fromEnd ? hi * (total / 2) : total - hi * (total / 2);
	};
	const s0 = pull(true);
	const s1 = pull(false);
	if (s0 === undefined || s1 === undefined || s1 - s0 < 0.3) return undefined;
	const sliced = slicePolyline(pts, s0, s1);
	return sliced.length >= 2 ? sliced : undefined;
}

/**
 * Drop the parts of a face-hosted run that have left the face polygon. Inset
 * lines on a tapering face (a logo spike) otherwise end in empty space, and
 * the tip sphere never meets the die.
 */
function clipLinesToHostFace(
	lines: ReadonlyArray<SupportEdgeLine>,
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform,
	marginMm: number
): Array<SupportEdgeLine> {
	const hostOf = (p: Vector3): number | undefined => {
		for (let i = 0; i < faces.length; i++) {
			if (pointOnHostFace(faces[i], p, printingTransform, marginMm)) return i;
		}
		return undefined;
	};
	const out: Array<SupportEdgeLine> = [];
	for (const line of lines) {
		if (line.faceIndex === undefined || line.points.length < 2) {
			out.push(line);
			continue;
		}
		const tagged = line.faceIndex;
		const onTagged = (p: Vector3) =>
			pointOnHostFace(faces[tagged], p, printingTransform, marginMm);
		if (line.points.every(onTagged)) {
			out.push(line);
			continue;
		}
		const len = polylineArcLength(line.points);
		if (len < 1e-6) continue;
		const n = Math.max(2, Math.ceil(len / 0.25));
		const samples: Array<{ p: Vector3; host: number | undefined }> = [];
		for (let i = 0; i <= n; i++) {
			const p = pointAtArc(line.points, (i / n) * len);
			samples.push({ p, host: hostOf(p) });
		}
		let runStart = -1;
		const flush = (end: number) => {
			if (runStart < 0) return;
			const host = samples[runStart].host;
			const pts = samples.slice(runStart, end + 1).map((s) => s.p.clone());
			if (host !== undefined && pts.length >= 2 && polylineArcLength(pts) >= 0.3) {
				out.push({ ...line, points: pts, faceIndex: host });
			}
			runStart = -1;
		};
		for (let i = 0; i < samples.length; i++) {
			const host = samples[i].host;
			if (host === undefined) {
				if (runStart >= 0) flush(i - 1);
				continue;
			}
			if (runStart < 0) {
				runStart = i;
			} else if (samples[runStart].host !== host) {
				flush(i - 1);
				runStart = i;
			}
		}
		if (runStart >= 0) flush(samples.length - 1);
	}
	return out;
}

function pointOnHostFace(
	face: DieFaceModel,
	p: Vector3,
	printingTransform: Transform,
	marginMm: number
): boolean {
	const local = printPointToFaceLocal(face, p, printingTransform);
	if (!local) return false;
	const projected = facePointPrint(face, local, printingTransform);
	// On the face, not merely near its plane. A point hovering beside a bevel
	// can project inside a neighbouring facet and look hosted while the sphere
	// never meets the mesh.
	if (projected.distanceTo(p) > 0.05) return false;
	const outline = openLoop2d(face.shape.getPoints(OUTLINE_DIVISIONS));
	if (outline.length < 3 || !pointInPolygon2d(local, outline)) return false;
	if (marginMm <= 0) return true;
	for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
		if (distanceToSegment2d(local, outline[j], outline[i]) < marginMm - 1e-6) return false;
	}
	return true;
}

/** Direction change below this is a curve chord, not a polygon corner. */
const CURVE_TURN_DOT = Math.cos((18 * Math.PI) / 180);

type CurveChain = { points: Array<Vector3>; edges: Array<SharpEdge> };

/**
 * Join sharp edges that turn gently through a shared vertex into one curve.
 * A faceted polygon corner (cube, d10, low-segment coin) is left alone. A
 * smooth rim or rounded end becomes a single chain so spacing and end-trim
 * apply to the whole curve instead of each tiny chord.
 */
function chainCurveEdges(edges: ReadonlyArray<SharpEdge>): {
	chains: Array<CurveChain>;
	used: Set<SharpEdge>;
} {
	const adj = new Map<string, Array<SharpEdge>>();
	const touch = (key: string, e: SharpEdge) => {
		const list = adj.get(key);
		if (list) list.push(e);
		else adj.set(key, [e]);
	};
	for (const e of edges) {
		touch(weldKey(e.a), e);
		touch(weldKey(e.b), e);
	}
	const used = new Set<SharpEdge>();
	const chains: Array<CurveChain> = [];

	const smoothNext = (incoming: Vector3, at: Vector3, prev: SharpEdge): SharpEdge | undefined => {
		const list = adj.get(weldKey(at));
		if (!list) return undefined;
		const cands: Array<SharpEdge> = [];
		for (const e of list) {
			if (e === prev || used.has(e)) continue;
			const other = weldKey(e.a) === weldKey(at) ? e.b : weldKey(e.b) === weldKey(at) ? e.a : undefined;
			if (!other) continue;
			const dir = new Vector3().subVectors(other, at);
			if (dir.lengthSq() < 1e-12) continue;
			dir.normalize();
			if (incoming.dot(dir) >= CURVE_TURN_DOT) cands.push(e);
		}
		return cands.length === 1 ? cands[0] : undefined;
	};

	for (const start of edges) {
		if (used.has(start)) continue;
		const points: Array<Vector3> = [start.a.clone(), start.b.clone()];
		const chainEdges: Array<SharpEdge> = [start];
		used.add(start);

		let dir = new Vector3().subVectors(start.b, start.a);
		if (dir.lengthSq() < 1e-12) {
			used.delete(start);
			continue;
		}
		dir.normalize();
		let at = start.b;
		let prev = start;
		for (;;) {
			const next = smoothNext(dir, at, prev);
			if (!next) break;
			const nextAt = weldKey(next.a) === weldKey(at) ? next.b : next.a;
			dir = new Vector3().subVectors(nextAt, at);
			if (dir.lengthSq() < 1e-12) break;
			dir.normalize();
			used.add(next);
			chainEdges.push(next);
			points.push(nextAt.clone());
			at = nextAt;
			prev = next;
			if (chainEdges.length > edges.length) break;
		}

		dir = new Vector3().subVectors(start.a, start.b).normalize();
		at = start.a;
		prev = start;
		for (;;) {
			const next = smoothNext(dir, at, prev);
			if (!next) break;
			const nextAt = weldKey(next.a) === weldKey(at) ? next.b : next.a;
			dir = new Vector3().subVectors(nextAt, at);
			if (dir.lengthSq() < 1e-12) break;
			dir.normalize();
			used.add(next);
			chainEdges.unshift(next);
			points.unshift(nextAt.clone());
			at = nextAt;
			prev = next;
			if (chainEdges.length > edges.length) break;
		}

		if (chainEdges.length >= 2) chains.push({ points, edges: chainEdges });
		else used.delete(start);
	}
	return { chains, used };
}

/** True when both endpoints sit on the lowest horizontal resting edge (edge-down pose). */
export function isBaseRestingEdge(a: Vector3, b: Vector3, minY: number, eps = 0.15): boolean {
	return (
		Math.abs(a.y - b.y) <= eps &&
		Math.abs(a.y - minY) <= eps &&
		Math.abs(b.y - minY) <= eps
	);
}

/**
 * Which faces along an edge should receive inset support runs.
 * - 2+ faces at or above the min outward angle: each gets a run.
 * - 1 steep face meeting a near-vertical neighbour: only the steep face
 *   (edge-down cube sides). Skip 1 steep + clearly inward (d10 short edges).
 * Faces within the cutoff of vertical do not get edge supports.
 */
export function insetSupportFacesAtEdge(
	faces: ReadonlyArray<DieFaceModel>,
	edgeFaces: ReadonlyArray<{ faceIndex: number }>,
	printingTransform: Transform,
	minAngleDeg = DEFAULT_SUPPORT_SETTINGS.faceMinAngleDeg
): Array<{ faceIndex: number; normal: Vector3 }> {
	const outward = outwardFacesAtEdge(faces, edgeFaces, printingTransform, minAngleDeg);
	if (outward.length >= 2) return outward;
	if (
		outward.length === 1 &&
		edgeHasNearVerticalFace(faces, edgeFaces, printingTransform, minAngleDeg)
	) {
		return outward;
	}
	return [];
}

function distPointToSegment(p: Vector3, a: Vector3, b: Vector3): number {
	const ab = new Vector3().subVectors(b, a);
	const lenSq = ab.lengthSq();
	if (lenSq < 1e-12) return p.distanceTo(a);
	const t = Math.max(0, Math.min(1, new Vector3().subVectors(p, a).dot(ab) / lenSq));
	return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * The two vertices farthest from the resting edge — the outer tips of an
 * edge-down tetrahedron. Ignores Steiner/centroid verts from segmented faces
 * (those sit closer to the edge than the real tips).
 */
function findTetraOuterTips(
	sharp: ReadonlyArray<SharpEdge>,
	baseA: Vector3,
	baseB: Vector3
): Array<Vector3> {
	const seen = new Set<string>();
	const keyOf = (p: Vector3) =>
		`${Math.round(p.x / VERT_WELD_MM)}:${Math.round(p.y / VERT_WELD_MM)}:${Math.round(p.z / VERT_WELD_MM)}`;
	const scored: Array<{ p: Vector3; d: number }> = [];
	for (const e of sharp) {
		for (const p of [e.a, e.b]) {
			const d = distPointToSegment(p, baseA, baseB);
			// Must sit clearly off the resting edge (drops mid-edge split points).
			if (d < 1.0) continue;
			const k = keyOf(p);
			if (seen.has(k)) continue;
			seen.add(k);
			scored.push({ p: p.clone(), d });
		}
	}
	scored.sort((u, v) => v.d - u.d);
	if (scored.length < 2) return [];
	return [scored[0].p, scored[1].p];
}

/**
 * Merge collinear base-resting sharp edges (kite d4 splits one tetra edge into
 * two halves) into a single segment spanning the full resting crease.
 */
function mergeBaseRestingSegment(
	baseEdges: ReadonlyArray<SharpEdge>
): { a: Vector3; b: Vector3 } | undefined {
	if (baseEdges.length === 0) return undefined;
	let longest = baseEdges[0];
	let longestLen = longest.a.distanceTo(longest.b);
	for (const e of baseEdges) {
		const len = e.a.distanceTo(e.b);
		if (len > longestLen) {
			longest = e;
			longestLen = len;
		}
	}
	const dir = new Vector3().subVectors(longest.b, longest.a);
	if (dir.lengthSq() < 1e-12) return undefined;
	dir.normalize();
	const origin = longest.a;
	let minT = Infinity;
	let maxT = -Infinity;
	let minP = longest.a;
	let maxP = longest.b;
	for (const e of baseEdges) {
		for (const p of [e.a, e.b]) {
			const t = new Vector3().subVectors(p, origin).dot(dir);
			if (t < minT) {
				minT = t;
				minP = p;
			}
			if (t > maxT) {
				maxT = t;
				maxP = p;
			}
		}
	}
	return { a: minP.clone(), b: maxP.clone() };
}

/**
 * Edge-down tetrahedron: two median support rows from the resting-edge midpoint
 * up each lower face toward the two outer tips.
 */
function appendTetraFaceRowLines(
	sharp: ReadonlyArray<SharpEdge>,
	baseA: Vector3,
	baseB: Vector3,
	outward: Array<{ faceIndex: number; normal: Vector3 }>,
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform,
	trimMm: number,
	lines: Array<SupportEdgeLine>
): void {
	if (outward.length < 2) return;
	const tips = findTetraOuterTips(sharp, baseA, baseB);
	if (tips.length !== 2) return;

	const mid = new Vector3().addVectors(baseA, baseB).multiplyScalar(0.5);
	for (const tip of tips) {
		// Assign tip to the outward face whose centroid is closest.
		let best = outward[0];
		let bestD = Infinity;
		for (const o of outward) {
			const c = faceCentroidPrint(faces[o.faceIndex], printingTransform);
			const d = c.distanceToSquared(tip);
			if (d < bestD) {
				bestD = d;
				best = o;
			}
		}
		const dir = new Vector3().subVectors(tip, mid);
		const len = dir.length();
		if (len < 2 * trimMm + 1e-6) continue;
		dir.multiplyScalar(1 / len);
		const start = mid.clone().addScaledVector(dir, trimMm);
		const end = tip.clone().addScaledVector(dir, -trimMm);
		lines.push({
			points: [start, end],
			normal: best.normal.clone(),
			avoidLegends: true,
			faceIndex: best.faceIndex
		});
	}
}

function segmentKey(a: Vector3, b: Vector3): string {
	const ka = weldKey(a);
	const kb = weldKey(b);
	return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * A smooth half-cylinder belly (the infinity die's lower cap) has no crease
 * across its width, so edge detection only supports the two rims. When a run
 * of hidden quads shares smooth long edges and faces mostly downward, lay
 * three lines along those long edges: the two ends of the downward run and
 * its middle. That holds the flat bulk between the rims.
 */
function addSmoothUndersideLines(
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform,
	sharp: ReadonlyArray<SharpEdge>,
	lines: Array<SupportEdgeLine>,
	insetMm: number,
	minAngleDeg: number
): void {
	const sharpKeys = new Set<string>();
	for (const e of sharp) sharpKeys.add(segmentKey(e.a, e.b));
	const downwardMin = Math.max(minAngleDeg, 60);

	type Quad = {
		faceIndex: number;
		normal: Vector3;
		a: Vector3;
		b: Vector3;
		longKeys: [string, string];
	};
	const quads: Array<Quad> = [];
	for (let fi = 0; fi < faces.length; fi++) {
		const face = faces[fi];
		const outline = outlinePoints2d(face).map((p) => facePointPrint(face, p, printingTransform));
		if (outline.length !== 4) continue;
		const edges = [0, 1, 2, 3].map((i) => {
			const a = outline[i];
			const b = outline[(i + 1) % 4];
			return { a, b, len: a.distanceTo(b), key: segmentKey(a, b) };
		});
		edges.sort((p, q) => q.len - p.len);
		const long0 = edges[0];
		const long1 = edges[1];
		const short0 = edges[2];
		const short1 = edges[3];
		if (long1.len < 4 || long1.len < short0.len * 3) continue;
		if (sharpKeys.has(long0.key) || sharpKeys.has(long1.key)) continue;
		const normal = faceNormalPrint(face, printingTransform);
		if (!faceNeedsEdgeSupports(normal, downwardMin)) continue;
		quads.push({
			faceIndex: fi,
			normal,
			a: new Vector3().lerpVectors(short0.a, short0.b, 0.5),
			b: new Vector3().lerpVectors(short1.a, short1.b, 0.5),
			longKeys: [long0.key, long1.key]
		});
	}
	if (quads.length < 3) return;

	const byKey = new Map<string, Array<number>>();
	quads.forEach((q, i) => {
		for (const key of q.longKeys) {
			const list = byKey.get(key) ?? [];
			list.push(i);
			byKey.set(key, list);
		}
	});
	const neighbor = (i: number, seen: Set<number>): number | undefined => {
		for (const key of quads[i].longKeys) {
			for (const j of byKey.get(key) ?? []) {
				if (j !== i && !seen.has(j)) return j;
			}
		}
		return undefined;
	};
	const used = new Set<number>();
	for (let seed = 0; seed < quads.length; seed++) {
		if (used.has(seed)) continue;
		const seenToEnd = new Set<number>();
		let end = seed;
		for (;;) {
			seenToEnd.add(end);
			const next = neighbor(end, seenToEnd);
			if (next === undefined) break;
			end = next;
		}
		const chain = [end];
		const seen = new Set<number>([end]);
		for (;;) {
			const next = neighbor(chain[chain.length - 1], seen);
			if (next === undefined) break;
			seen.add(next);
			chain.push(next);
		}
		for (const i of chain) used.add(i);
		if (chain.length < 3) continue;
		const picks = [chain[0], chain[Math.floor(chain.length / 2)], chain[chain.length - 1]];
		for (const i of picks) {
			const q = quads[i];
			const trimmed = trimSegmentEnds(q.a, q.b, insetMm);
			if (!trimmed) continue;
			lines.push({
				points: trimmed,
				normal: q.normal.clone(),
				faceIndex: q.faceIndex
			});
		}
	}
}

export function computeEdgeSupportLines(
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform,
	settings: SupportSettings,
	opts: { cancel?: SupportCancelToken; onProgress?: SupportProgressFn } = {}
): Array<SupportEdgeLine> {
	const { cancel, onProgress } = opts;
	onProgress?.('edge-regions', 0);
	const sharp = collectSharpEdges(faces, printingTransform);
	const lines: Array<SupportEdgeLine> = [];
	const insetMm = edgeInsetForSphere(settings);
	const minAngle = settings.faceMinAngleDeg;

	let minY = Infinity;
	for (const e of sharp) {
		if (e.a.y < minY) minY = e.a.y;
		if (e.b.y < minY) minY = e.b.y;
	}

	// Edge-down resting crease(s): merge collinear halves, one on-edge run, and
	// (for tetrahedra) two face-median rows toward the outer tips.
	const baseEdges: Array<SharpEdge> = [];
	const baseEdgeKeys = new Set<string>();
	const edgeKey = (e: SharpEdge) => {
		const ka = weldKey(e.a);
		const kb = weldKey(e.b);
		return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
	};
	if (Number.isFinite(minY)) {
		for (const e of sharp) {
			if (!isBaseRestingEdge(e.a, e.b, minY)) continue;
			const outward = outwardFacesAtEdge(faces, e.faces, printingTransform, minAngle);
			if (outward.length < 2) continue;
			baseEdges.push(e);
			baseEdgeKeys.add(edgeKey(e));
		}
	}
	if (baseEdges.length > 0) {
		const merged = mergeBaseRestingSegment(baseEdges);
		const outwardAll: Array<{ faceIndex: number; normal: Vector3 }> = [];
		const seenFace = new Set<number>();
		for (const e of baseEdges) {
			for (const o of outwardFacesAtEdge(faces, e.faces, printingTransform, minAngle)) {
				if (seenFace.has(o.faceIndex)) continue;
				seenFace.add(o.faceIndex);
				outwardAll.push(o);
			}
		}
		if (merged) {
			const trimmed = trimSegmentEnds(merged.a, merged.b, insetMm);
			if (trimmed) {
				const normal = new Vector3();
				for (const o of outwardAll) normal.add(o.normal);
				if (normal.lengthSq() < 1e-12) {
					normal.set(0, 1, 0);
				} else {
					normal.normalize();
				}
				lines.push({ points: trimmed, normal });
			}
			// Face-median rows are for tetrahedra (no vertical side faces). An
			// edge-down cube has outward/vertical creases instead — skip rows there.
			const hasVerticalSideCrease = sharp.some((e) => {
				if (baseEdgeKeys.has(edgeKey(e))) return false;
				const outs = outwardFacesAtEdge(faces, e.faces, printingTransform, minAngle);
				return (
					outs.length === 1 && edgeHasVerticalFace(faces, e.faces, printingTransform)
				);
			});
			if (!hasVerticalSideCrease) {
				appendTetraFaceRowLines(
					sharp,
					merged.a,
					merged.b,
					outwardAll,
					faces,
					printingTransform,
					insetMm,
					lines
				);
			}
		}
	}

	// A rounded rim or cylinder end is many short sharp chords. Chain the ones
	// that turn gently and support the whole curve, instead of trimming each
	// chord away on its own.
	const { chains, used: curvedEdges } = chainCurveEdges(sharp);
	const curveNormalDot = Math.cos((35 * Math.PI) / 180);
	for (const chain of chains) {
		type CurveRun = { normal: Vector3; faceIndex: number; pts: Array<Vector3> };
		let run: CurveRun | undefined;
		const flush = () => {
			if (!run || run.pts.length < 2) {
				run = undefined;
				return;
			}
			run.normal.normalize();
			const trimmed = trimPolylineEnds(run.pts, insetMm);
			if (trimmed) {
				lines.push({ points: trimmed, normal: run.normal, faceIndex: run.faceIndex });
			}
			run = undefined;
		};
		for (let i = 0; i < chain.edges.length; i++) {
			const e = chain.edges[i];
			if (baseEdgeKeys.has(edgeKey(e))) {
				flush();
				continue;
			}
			const outs = insetSupportFacesAtEdge(faces, e.faces, printingTransform, minAngle);
			if (outs.length === 0) {
				flush();
				continue;
			}
			let chosen = outs[0];
			if (run) {
				const same = outs.find(
					(o) => o.faceIndex === run!.faceIndex || run!.normal.dot(o.normal) >= curveNormalDot
				);
				if (same) chosen = same;
				else {
					flush();
					chosen = outs[0];
				}
			}
			const inset = insetSegmentOntoFace(
				chain.points[i],
				chain.points[i + 1],
				faces[chosen.faceIndex],
				printingTransform,
				insetMm
			);
			if (!inset) {
				flush();
				continue;
			}
			if (!run) {
				run = {
					normal: chosen.normal.clone(),
					faceIndex: chosen.faceIndex,
					pts: [inset[0], inset[1]]
				};
			} else {
				const last = run.pts[run.pts.length - 1];
				if (last.distanceTo(inset[0]) > 0.05) run.pts.push(inset[0]);
				run.pts.push(inset[1]);
			}
		}
		flush();
	}

	for (let i = 0; i < sharp.length; i++) {
		assertNotCancelled(cancel);
		const e = sharp[i];
		if (curvedEdges.has(e) || baseEdgeKeys.has(edgeKey(e))) {
			onProgress?.('edge-regions', (i + 1) / Math.max(1, sharp.length));
			continue;
		}
		const seg = supportEdgeSegment(e.a, e.b);
		if (!seg) continue;

		const insetFaces = insetSupportFacesAtEdge(faces, e.faces, printingTransform, minAngle);
		for (const { faceIndex, normal } of insetFaces) {
			const face = faces[faceIndex];
			const inset = insetSegmentOntoFace(seg[0], seg[1], face, printingTransform, insetMm);
			if (!inset) continue;
			// Centre clearance from the corners, matching the inset from this edge.
			// Adjoining-edge sphere overflow is clipped after every line is built.
			const trimmed = trimSegmentEnds(inset[0], inset[1], insetMm);
			if (!trimmed) continue;
			lines.push({
				points: trimmed,
				normal,
				faceIndex
			});
		}
		onProgress?.('edge-regions', (i + 1) / Math.max(1, sharp.length));
	}

	addSmoothUndersideLines(faces, printingTransform, sharp, lines, insetMm, minAngle);

	const radius = Math.max(0, settings.sphereDiameterMm / 2);
	const planes = faces.map((face) => ({
		point: faceCentroidPrint(face, printingTransform),
		normal: faceNormalPrint(face, printingTransform),
		face
	}));
	const fitted: Array<SupportEdgeLine> = [];
	for (const line of lines) {
		const clipped =
			line.points.length > 2
				? clipPolylineForSphere(
						line.points,
						sharp,
						radius,
						planes,
						line.normal,
						printingTransform
					)
				: clipSupportLineForSphere(
						line.points[0],
						line.points[1],
						sharp,
						radius,
						planes,
						printingTransform,
						line.normal
					);
		if (!clipped) continue;
		fitted.push({ ...line, points: clipped });
	}

	// A sharp tip is narrower than the inset, so the run can leave the face and
	// hang in the air past the corner. Keep only the span that still lies on
	// the host face, far enough in that the tip sphere meets the die.
	const hosted = clipLinesToHostFace(fitted, faces, printingTransform, radius);

	onProgress?.('edge-regions', 1);
	return hosted;
}

const ENGRAVE_PLANE_EPS_MM = 0.45;

/** Convex hull (CCW) of a 2D point set. Collinear edge points are dropped. */
function convexHull2d(points: ReadonlyArray<Vector2>): Array<Vector2> {
	if (points.length < 3) return points.map((p) => p.clone());
	const pts = points
		.map((p) => p.clone())
		.sort((a, b) => a.x - b.x || a.y - b.y);
	const deduped: Array<Vector2> = [];
	for (const p of pts) {
		const prev = deduped[deduped.length - 1];
		if (prev && prev.distanceToSquared(p) < 1e-12) continue;
		deduped.push(p);
	}
	if (deduped.length < 3) return deduped;
	const cross = (o: Vector2, a: Vector2, b: Vector2) =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: Array<Vector2> = [];
	for (const p of deduped) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
			lower.pop();
		}
		lower.push(p);
	}
	const upper: Array<Vector2> = [];
	for (let i = deduped.length - 1; i >= 0; i--) {
		const p = deduped[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
			upper.pop();
		}
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

/**
 * One convex hull around every contour of the face's legend. Counters and gaps
 * between strokes (the inside of a "4") are part of the legend area, so edge
 * spheres are not threaded through them.
 */
function legendAreaHull(shapes: ReadonlyArray<Shape>): Array<Vector2> | undefined {
	const pts: Array<Vector2> = [];
	for (const shape of shapes) {
		pts.push(...shape.getPoints(DefaultDivisions));
		for (const hole of shape.holes) pts.push(...hole.getPoints(DefaultDivisions));
	}
	if (pts.length < 3) return undefined;
	const hull = convexHull2d(pts);
	return hull.length >= 3 ? hull : undefined;
}

function distanceToSegment2d(p: Vector2, a: Vector2, b: Vector2): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const lenSq = abx * abx + aby * aby;
	if (lenSq < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
	let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
	if (t < 0) t = 0;
	else if (t > 1) t = 1;
	return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** True when `p` is inside the hull or within `marginMm` of its boundary. */
function inExpandedHull(p: Vector2, hull: ReadonlyArray<Vector2>, marginMm: number): boolean {
	if (pointInPolygon2d(p, hull as Array<Vector2>)) return true;
	if (marginMm <= 0) return false;
	for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
		if (distanceToSegment2d(p, hull[j], hull[i]) <= marginMm) return true;
	}
	return false;
}

/**
 * True when `p` lies in (or within `marginMm` of) the legend hull on any face
 * whose plane it sits on. The hull covers the whole legend, including counters,
 * so an edge run cannot place spheres inside a digit.
 */
function pointInLegendArea(
	p: Vector3,
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform,
	hulls: ReadonlyArray<Array<Vector2> | undefined>,
	marginMm: number
): boolean {
	for (let fi = 0; fi < faces.length; fi++) {
		const hull = hulls[fi];
		if (!hull) continue;
		const face = faces[fi];
		if (face.hidden) continue;
		const local = printPointToFaceLocal(face, p, printingTransform);
		if (!local) continue;
		const projected = facePointPrint(face, local, printingTransform);
		if (projected.distanceTo(p) > ENGRAVE_PLANE_EPS_MM) continue;
		const outline = openLoop2d(face.shape.getPoints(OUTLINE_DIVISIONS));
		if (!pointInPolygon2d(local, outline)) continue;
		if (inExpandedHull(local, hull, marginMm)) return true;
	}
	return false;
}

/**
 * Split face-attached support runs so they do not enter a legend hull.
 * Contiguous spans outside the hull become separate lines; a run that lies
 * entirely in the legend area is dropped.
 */
export function carveEngravingFromSupportLines(
	lines: ReadonlyArray<SupportEdgeLine>,
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform,
	faceLegendShapes: ReadonlyArray<ReadonlyArray<Shape>>,
	sampleStepMm = 0.25,
	marginMm = 0.15
): Array<SupportEdgeLine> {
	const hulls = faceLegendShapes.map((shapes) =>
		shapes && shapes.length > 0 ? legendAreaHull(shapes) : undefined
	);
	const hasAnyEngraving = hulls.some((h) => h !== undefined);
	const out: Array<SupportEdgeLine> = [];
	for (const line of lines) {
		// On-edge base runs have no face; face rows and inset runs do.
		if (line.faceIndex === undefined || !hasAnyEngraving) {
			out.push(line);
			continue;
		}
		if (line.points.length < 2) continue;
		const len = polylineArcLength(line.points);
		if (len < 1e-6) continue;
		const n = Math.max(2, Math.ceil(len / sampleStepMm));
		type Sample = { p: Vector3; solid: boolean };
		const samples: Array<Sample> = [];
		for (let i = 0; i <= n; i++) {
			const p = pointAtArc(line.points, (i / n) * len);
			const solid = !pointInLegendArea(p, faces, printingTransform, hulls, marginMm);
			samples.push({ p, solid });
		}
		if (samples.every((s) => s.solid)) {
			out.push(line);
			continue;
		}
		let runStart = -1;
		const flush = (end: number) => {
			if (runStart < 0) return;
			const pts = samples.slice(runStart, end + 1).map((s) => s.p.clone());
			if (pts.length < 2 || polylineArcLength(pts) < sampleStepMm * 0.5) {
				runStart = -1;
				return;
			}
			out.push({
				points: pts,
				normal: line.normal.clone(),
				avoidLegends: line.avoidLegends,
				faceIndex: line.faceIndex
			});
			runStart = -1;
		};
		for (let i = 0; i < samples.length; i++) {
			if (samples[i].solid) {
				if (runStart < 0) runStart = i;
			} else {
				flush(i - 1);
			}
		}
		flush(samples.length - 1);
	}
	return out;
}

// --- Legend island detection (swappable) ----------------------------------------

export type LegendSupportInput = {
	faces: ReadonlyArray<DieFaceModel>;
	/** Per-face oriented legend shapes in face-local 2D (already scaled/rotated/offset). */
	faceLegendShapes: ReadonlyArray<ReadonlyArray<Shape>>;
	printingTransform: Transform;
	settings: SupportSettings;
	cancel?: SupportCancelToken;
	onProgress?: SupportProgressFn;
};

/**
 * Detector interface. Default = contour anchors + even spacing; swap via
 * {@link setLegendSupportDetector}. Detection may be slow — run off the main thread.
 */
export type LegendSupportDetector = (input: LegendSupportInput) => Array<SupportLegendPoint>;

function faceEligibleForLegendSupports(normal: Vector3): boolean {
	// Same rule as edge supports: only outward-sloping faces.
	return faceSlopesOutward(normal);
}

function contourPointsPrint(
	loop: Array<Vector2>,
	face: DieFaceModel,
	printingTransform: Transform
): Array<Vector3> {
	return loop.map((p) => facePointPrint(face, p, printingTransform));
}

function openLoop2d(pts: Array<Vector2>): Array<Vector2> {
	if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-9) {
		return pts.slice(0, -1);
	}
	return pts;
}

function pointInPolygon2d(p: Vector2, poly: Array<Vector2>): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const vi = poly[i];
		const vj = poly[j];
		const crosses =
			vi.y > p.y !== vj.y > p.y &&
			p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x;
		if (crosses) inside = !inside;
	}
	return inside;
}

/** True when `p` lies in the engraved fill of any legend shape on the face. */
export function pointInLegendEngraving(
	shapes: ReadonlyArray<Shape>,
	p: Vector2,
	divisions = DefaultDivisions
): boolean {
	for (const shape of shapes) {
		const outer = openLoop2d(shape.getPoints(divisions));
		if (!pointInPolygon2d(p, outer)) continue;
		let inHole = false;
		for (const hole of shape.holes) {
			if (pointInPolygon2d(p, openLoop2d(hole.getPoints(divisions)))) {
				inHole = true;
				break;
			}
		}
		if (!inHole) return true;
	}
	return false;
}

/**
 * Legend supports: local print-Y minima are fixed weakness anchors; additional
 * contacts are placed with even spacing along each contour between those
 * anchors (or around the whole loop when none are found). Each sample is nudged
 * onto solid face material beside the engraving.
 */
export const detectLegendSupportsLocalMinima: LegendSupportDetector = (input) => {
	const { faces, faceLegendShapes, printingTransform, settings, cancel, onProgress } = input;
	const tipR = settings.sphereDiameterMm / 2;
	const nudge = Math.max(tipR + 0.05, settings.edgeInsetMm * 0.5);
	const spacing = Math.max(0.5, settings.legendSpacingMm);
	const out: Array<SupportLegendPoint> = [];
	const nFaces = faces.length;

	for (let fi = 0; fi < nFaces; fi++) {
		assertNotCancelled(cancel);
		onProgress?.('legend-regions', fi / Math.max(1, nFaces));
		const face = faces[fi];
		if (face.hidden) continue;
		const normal = faceNormalPrint(face, printingTransform);
		if (!faceEligibleForLegendSupports(normal)) continue;

		const shapes = faceLegendShapes[fi] ?? [];
		for (const shape of shapes) {
			const outer = shape.getPoints(DefaultDivisions);
			collectContourSupports(
				outer,
				face,
				shapes,
				printingTransform,
				normal,
				nudge,
				spacing,
				false,
				out
			);

			const holes = shape.getPointsHoles(DefaultDivisions);
			for (const hole of holes) {
				collectContourSupports(
					hole,
					face,
					shapes,
					printingTransform,
					normal,
					nudge,
					spacing,
					true,
					out
				);
			}
		}
	}

	onProgress?.('legend-regions', 1);
	return out;
};

/** Cumulative arc lengths along a closed 2D loop; `cum[n]` is the full perimeter. */
function loopArcLengths(pts2: Array<Vector2>): { cum: Float64Array; total: number } {
	const n = pts2.length;
	const cum = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) {
		cum[i + 1] = cum[i] + pts2[i].distanceTo(pts2[(i + 1) % n]);
	}
	return { cum, total: cum[n] };
}

/** Sample position and forward tangent at arc length `s` on a closed loop. */
function sampleLoopAt(
	pts2: Array<Vector2>,
	cum: Float64Array,
	total: number,
	s: number
): { p: Vector2; tangent: Vector2 } | undefined {
	const n = pts2.length;
	if (n < 2 || total < 1e-9) return undefined;
	let u = ((s % total) + total) % total;
	let i = 0;
	while (i < n - 1 && cum[i + 1] < u - 1e-12) i++;
	const segLen = cum[i + 1] - cum[i];
	const t = segLen > 1e-12 ? (u - cum[i]) / segLen : 0;
	const a = pts2[i];
	const b = pts2[(i + 1) % n];
	const p = new Vector2().lerpVectors(a, b, t);
	const tangent = new Vector2().subVectors(b, a);
	if (tangent.lengthSq() < 1e-14) {
		// Degenerate segment — fall back to neighbouring span.
		const c = pts2[(i + 2) % n];
		tangent.subVectors(c, a);
	}
	if (tangent.lengthSq() < 1e-14) return undefined;
	tangent.normalize();
	return { p, tangent };
}

/** Local print-Y minima vertex indices (one per plateau). */
function localMinimaIndices(pts3: Array<Vector3>): Array<number> {
	const n = pts3.length;
	const out: Array<number> = [];
	for (let i = 0; i < n; i++) {
		const prev = pts3[(i - 1 + n) % n];
		const curr = pts3[i];
		const next = pts3[(i + 1) % n];
		if (!(curr.y <= prev.y + 1e-9 && curr.y <= next.y + 1e-9)) continue;
		if (curr.y >= prev.y - 1e-9 && curr.y >= next.y - 1e-9 && prev.y === next.y) {
			if (!(prev.y > curr.y + 1e-9 || next.y > curr.y + 1e-9)) {
				if (i > 0 && pts3[i - 1].y <= curr.y + 1e-9) continue;
			}
		}
		out.push(i);
	}
	return out;
}

function solidDirFromTangent(tangent: Vector2, pts2: Array<Vector2>, isHole: boolean): Vector2 {
	const left = new Vector2(-tangent.y, tangent.x);
	const cw = ShapeUtils.isClockWise(pts2);
	// Solid die material is OUTSIDE the engraved fill for outers, INSIDE for holes.
	const outward = cw ? left : left.clone().negate();
	if (!isHole) return outward.normalize();
	return outward.negate().normalize();
}

function collectContourSupports(
	loop2d: Array<Vector2>,
	face: DieFaceModel,
	faceShapes: ReadonlyArray<Shape>,
	printingTransform: Transform,
	normal: Vector3,
	nudgeMm: number,
	spacingMm: number,
	isHole: boolean,
	out: Array<SupportLegendPoint>
): void {
	const pts2 = openLoop2d(loop2d);
	if (pts2.length < 3) return;

	const pts3 = contourPointsPrint(pts2, face, printingTransform);
	const { cum, total } = loopArcLengths(pts2);
	if (total < 1e-6) return;

	const faceOutline = openLoop2d(face.shape.getPoints(OUTLINE_DIVISIONS));
	const anchors = localMinimaIndices(pts3);

	// Arc-length sample positions: anchors fixed, even spacing between them.
	const sampleArcs: Array<number> = [];
	if (anchors.length === 0) {
		const count = Math.max(1, Math.round(total / spacingMm));
		for (let i = 0; i < count; i++) {
			sampleArcs.push((i * total) / count);
		}
	} else {
		for (let a = 0; a < anchors.length; a++) {
			const i0 = anchors[a];
			const i1 = anchors[(a + 1) % anchors.length];
			const s0 = cum[i0];
			let arcLen = a + 1 < anchors.length ? cum[i1] - s0 : total - s0 + cum[i1];
			if (arcLen < 0) arcLen += total;
			const segments = Math.max(1, Math.round(arcLen / spacingMm));
			for (let s = 0; s < segments; s++) {
				sampleArcs.push((s0 + (s * arcLen) / segments) % total);
			}
		}
	}

	for (const arc of sampleArcs) {
		const sample = sampleLoopAt(pts2, cum, total, arc);
		if (!sample) continue;
		const solidDir = solidDirFromTangent(sample.tangent, pts2, isHole);
		const nudgedLocal = placeOnSolidBesideContour(
			sample.p,
			solidDir,
			nudgeMm,
			faceShapes,
			faceOutline
		);
		if (!nudgedLocal) continue;
		const point = facePointPrint(face, nudgedLocal, printingTransform);
		out.push({ point, normal: normal.clone() });
	}
}

/**
 * Walk off the contour along `solidDir` (and the opposite if needed) until the
 * candidate sits on solid face material — outside every engraved fill and
 * still inside the face outline.
 */
function placeOnSolidBesideContour(
	origin: Vector2,
	solidDir: Vector2,
	nudgeMm: number,
	faceShapes: ReadonlyArray<Shape>,
	faceOutline: Array<Vector2>
): Vector2 | undefined {
	const dirs = [solidDir, solidDir.clone().negate()];
	for (const dir of dirs) {
		for (let step = 1; step <= 6; step++) {
			const candidate = origin.clone().addScaledVector(dir, nudgeMm * step);
			if (!pointInPolygon2d(candidate, faceOutline)) continue;
			if (pointInLegendEngraving(faceShapes, candidate)) continue;
			return candidate;
		}
	}
	return undefined;
}

/** Active legend detector — replace this binding to swap implementations. */
export let detectLegendSupports: LegendSupportDetector = detectLegendSupportsLocalMinima;

export function setLegendSupportDetector(detector: LegendSupportDetector): void {
	detectLegendSupports = detector;
}

/**
 * Orient each face's legend shapes into face-local 2D (scale → rotate → translate),
 * matching the engraving pipeline order.
 */
export function orientFaceLegendShapes(
	faces: ReadonlyArray<DieFaceModel>,
	faceParams: ReadonlyArray<FaceParams | undefined>,
	legends: LegendSet,
	defaultScaleFor: (legend: Legend) => number
): Array<Array<Shape>> {
	return faces.map((face, i) => {
		const fp = faceParams[i] ?? {};
		const legend = fp.legend ?? face.defaultLegend;
		if (legend === Legend.BLANK || face.hidden) {
			return [];
		}
		let symbols = legends.get(legend).map((s) => s.clone());
		const scale = fp.scale ?? defaultScaleFor(legend);
		if (scale && scale !== 1) {
			symbols = scaleShapes(scale, ...symbols);
		}
		if (fp.rotation) {
			symbols = rotateShapes(fp.rotation, ...symbols);
		}
		if (fp.offset && fp.offset.lengthSq() !== 0) {
			symbols = translateShapes(fp.offset, ...symbols);
		}
		return symbols;
	});
}

const TIP_Y_EPS = 1e-3;
const TIP_DIR_DEDUP_DOT = 0.97; // ~14°

/**
 * Locate the unique lowest sharp-edge vertex in print space and the unit
 * directions of sharp edges leaving it. Undefined for flat bottoms or tips
 * with fewer than 3 edges.
 */
export function detectTipPost(
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform
): SupportTipPost | undefined {
	const sharp = collectSharpEdges(faces, printingTransform);
	if (sharp.length === 0) return undefined;

	let minY = Infinity;
	for (const e of sharp) {
		if (e.a.y < minY) minY = e.a.y;
		if (e.b.y < minY) minY = e.b.y;
	}
	if (!Number.isFinite(minY)) return undefined;

	const tipKeys = new Set<string>();
	const tipPositions: Vector3[] = [];
	const keyOf = (p: Vector3) =>
		`${Math.round(p.x / TIP_Y_EPS)}:${Math.round(p.y / TIP_Y_EPS)}:${Math.round(p.z / TIP_Y_EPS)}`;

	for (const e of sharp) {
		for (const p of [e.a, e.b]) {
			if (Math.abs(p.y - minY) > TIP_Y_EPS) continue;
			const k = keyOf(p);
			if (tipKeys.has(k)) continue;
			tipKeys.add(k);
			tipPositions.push(p.clone());
		}
	}
	if (tipPositions.length !== 1) return undefined;

	const apex = tipPositions[0];
	const apexKey = keyOf(apex);
	const dirs: Vector3[] = [];
	for (const e of sharp) {
		const aAt = keyOf(e.a) === apexKey;
		const bAt = keyOf(e.b) === apexKey;
		if (!aAt && !bAt) continue;
		const other = aAt ? e.b : e.a;
		const d = new Vector3().subVectors(other, apex);
		if (d.lengthSq() < 1e-10) continue;
		d.normalize();
		if (d.y < -0.05) continue;
		if (dirs.some((u) => u.dot(d) > TIP_DIR_DEDUP_DOT)) continue;
		dirs.push(d);
	}

	if (dirs.length < 3) return undefined;
	return { apex, edgeDirs: dirs };
}

export function computeSupportRegions(
	faces: ReadonlyArray<DieFaceModel>,
	printingTransform: Transform,
	faceLegendShapes: ReadonlyArray<ReadonlyArray<Shape>>,
	settings: SupportSettings,
	opts: { cancel?: SupportCancelToken; onProgress?: SupportProgressFn } = {}
): SupportRegions {
	const rawEdgeLines = computeEdgeSupportLines(faces, printingTransform, settings, {
		cancel: opts.cancel,
		onProgress: (phase, frac) => opts.onProgress?.(phase, (frac ?? 0) * 0.4)
	});
	const legendPoints = detectLegendSupports({
		faces,
		faceLegendShapes,
		printingTransform,
		settings,
		cancel: opts.cancel,
		onProgress: (phase, frac) => opts.onProgress?.(phase, 0.4 + (frac ?? 0) * 0.45)
	});
	assertNotCancelled(opts.cancel);
	const edgeLines = carveEngravingFromSupportLines(
		rawEdgeLines,
		faces,
		printingTransform,
		faceLegendShapes,
		0.25,
		Math.max(0.1, settings.sphereDiameterMm / 2)
	);
	const tipPost = detectTipPost(faces, printingTransform);
	opts.onProgress?.('tip-post', 1);
	return { edgeLines, legendPoints, tipPost };
}
