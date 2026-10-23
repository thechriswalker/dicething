// Build SLA support solids from SupportRegions: vertical pillars, angled cones,
// tip spheres the cone pierces into, and one drafted raft under the whole set.
// The raft is the convex hull of the pillar feet, vented with hexagonal holes.
//
// Coordinates are print space (Y-up). The die manifold (also print-oriented) is
// used only to lean pillars clear of the body; supports are never booleaned into
// the die.

import { Mesh, MeshNormalMaterial, Vector3 } from 'three';
import {
	cloneManifold,
	deleteAll,
	manifold,
	manifoldToGeometry,
	mapOwned,
	type Manifold
} from '../manifold';
import {
	assertNotCancelled,
	SUPPORT_SETTING_LIMITS,
	type SupportCancelToken,
	type SupportContact,
	type SupportProgressFn,
	type SupportRegions,
	type SupportSettings
} from './types';
import { buildTipPostManifold } from './tip_post';
import { buildSupportRaft, type RaftFoot } from './raft';

const CYL_SEGMENTS = 16;
const SPHERE_SEGMENTS = 12;
const LEAN_STEPS = 12;
const PROBE_CLEAR_VOL = 1e-5;
/**
 * Air gap the pillar and cone must keep from the die. The tip sphere is allowed
 * to meet the face; this margin applies to the support body only.
 */
const BODY_CLEARANCE_MM = 0.5;
/** How far past the user's max lean a foot may go when that is what clears the die or the face. */
const CLEARANCE_LEAN_DEG = 75;
const FAN_STEP_DEG = 15;
/** Minimum cone lean so the head always angles toward the die (degrees). */
const MIN_HEAD_LEAN_DEG = 18;
/**
 * Cone tip radius as a fraction of the pillar radius. The cone pierces into
 * the sphere rather than matching its size; `coneTipRadiusMm` still caps the
 * tip so that disk fits inside the sphere.
 */
const CONE_TIP_PILLAR_FRACTION = 0.28;
/** How far the cone tip sits past the sphere surface toward its centre (× tipR). */
const CONE_PIERCE_FRACTION = 0.55;
/** Extra overlap of cone into the mitered pillar so the union seals. */
const CONE_PILLAR_OVERLAP_MM = 0.08;
/** Taper is at least this long; the cylindrical neck is whatever is left. */
const MIN_TAPER_MM = 0.35;
/** Skip the neck cylinder below this length — the joint sphere already covers it. */
const MIN_NECK_MM = 0.02;
/**
 * How far the neck and taper must stay off the face where they are outside the
 * tip sphere. The sphere is the only part allowed to embed in the face; the
 * cone only attaches to that sphere.
 */
const FACE_ATTACH_CLEARANCE_MM = 0.02;

const _material = new MeshNormalMaterial();

/**
 * Sample contacts along edge lines (spacing, always include the lower end) and
 * append legend points.
 *
 * Dedup only collapses samples that sit on the *same* face side (similar
 * normals). The two inset runs along one sharp edge are only ~2×inset apart, so
 * a naive distance check would drop one whole side of every edge.
 */
export function sampleSupportContacts(
	regions: SupportRegions,
	settings: SupportSettings
): Array<SupportContact> {
	const spacing = Math.max(SUPPORT_SETTING_LIMITS.edgeSpacingMm.min, settings.edgeSpacingMm);
	const minDist = spacing * 0.5;
	const minDistSq = minDist * minDist;
	const contacts: Array<SupportContact> = [];

	const tooCloseSameSide = (p: Vector3, normal: Vector3) =>
		contacts.some((c) => c.point.distanceToSquared(p) < minDistSq && c.normal.dot(normal) > 0.5);

	// Legend contacts first so face-row lines can leave gaps around them.
	for (const lp of regions.legendPoints) {
		if (tooCloseSameSide(lp.point, lp.normal)) continue;
		contacts.push({
			point: lp.point.clone(),
			normal: lp.normal.clone(),
			source: 'legend'
		});
	}

	const nearLegend = (p: Vector3) =>
		contacts.some((c) => c.source === 'legend' && c.point.distanceToSquared(p) < minDistSq);

	for (const line of regions.edgeLines) {
		const samples = samplesAlongRun(line.points, spacing, minDist);
		for (const p of samples) {
			if (line.avoidLegends && nearLegend(p)) continue;
			if (tooCloseSameSide(p, line.normal)) continue;
			contacts.push({ point: p, normal: line.normal.clone(), source: 'edge' });
		}
	}

	return contacts;
}

/** Contacts along a straight run or a curved polyline, spaced by arc length. */
function samplesAlongRun(
	points: ReadonlyArray<Vector3>,
	spacing: number,
	minDist: number
): Array<Vector3> {
	if (points.length < 2) return [];
	if (points.length > 2) {
		let total = 0;
		for (let i = 1; i < points.length; i++) total += points[i - 1].distanceTo(points[i]);
		if (total < 1e-6) return [points[0].clone()];
		const n = Math.max(1, Math.round(total / spacing));
		const samples: Array<Vector3> = [];
		for (let i = 0; i <= n; i++) samples.push(pointAlong(points, (i / n) * total));
		let low = points[0];
		for (const p of points) if (p.y < low.y) low = p;
		if (samples.every((s) => s.distanceTo(low) > minDist)) samples.push(low.clone());
		return samples;
	}
	const [a, b] = points;
	const lower = a.y <= b.y ? a : b;
	const upper = a.y <= b.y ? b : a;
	const samples: Array<Vector3> = [lower.clone()];
	const len = lower.distanceTo(upper);
	if (len > 1e-6) {
		const n = Math.max(0, Math.floor(len / spacing));
		for (let i = 1; i <= n; i++) {
			const t = Math.min(1, (i * spacing) / len);
			samples.push(new Vector3().lerpVectors(lower, upper, t));
		}
		if (upper.distanceTo(samples[samples.length - 1]) > minDist) {
			samples.push(upper.clone());
		}
	}
	return samples;
}

function pointAlong(points: ReadonlyArray<Vector3>, dist: number): Vector3 {
	if (dist <= 0) return points[0].clone();
	let s = 0;
	for (let i = 1; i < points.length; i++) {
		const seg = points[i - 1].distanceTo(points[i]);
		if (s + seg >= dist - 1e-9) {
			const t = seg > 1e-9 ? (dist - s) / seg : 0;
			return new Vector3().lerpVectors(points[i - 1], points[i], Math.min(1, Math.max(0, t)));
		}
		s += seg;
	}
	return points[points.length - 1].clone();
}

type FootPlacement = {
	/** Contact on the face (sphere centre). */
	contact: Vector3;
	/** Pillar axis at the plate (xz). */
	footX: number;
	footZ: number;
	/** Y of the cone / pillar junction centre (before miter overhang). */
	coneBaseY: number;
};

function outwardXz(
	contact: Vector3,
	normal: Vector3,
	dieCentroidXz: { x: number; z: number }
): Vector3 {
	// Prefer the face outward normal projected onto the build plate so the
	// pillar stands off the surface and the cone tips back toward the die.
	const out = new Vector3(normal.x, 0, normal.z);
	if (out.lengthSq() < 1e-8) {
		out.set(contact.x - dieCentroidXz.x, 0, contact.z - dieCentroidXz.z);
	}
	if (out.lengthSq() < 1e-8) {
		out.set(1, 0, 0);
	}
	return out.normalize();
}

/**
 * Place the pillar foot in xz. The first choice is the face normal, so the cone
 * tips back toward the face. The head leans far enough that the neck and taper
 * stay off that face and meet only the tip sphere — the sphere is what embeds
 * in the die. On a concave outline the normal can point into another lobe; the
 * foot then turns, and if needed leans past the usual limit, until the pillar
 * and the cone both sit clear of the die. Body clearance wins when no angle
 * can satisfy both.
 */
export function placeSupportFoot(
	contact: Vector3,
	normal: Vector3,
	settings: SupportSettings,
	diePrint: Manifold | undefined,
	dieCentroidXz: { x: number; z: number }
): FootPlacement {
	const pillarR = settings.pillarDiameterMm / 2;
	const tipR = Math.max(1e-3, settings.sphereDiameterMm / 2);
	const coneLen = Math.max(2, settings.coneLengthMm);
	const raft = Math.max(0, settings.raftDepthMm);
	// Cone base sits below the sphere so the angled head has room to pierce it.
	const coneBaseY = Math.max(raft, contact.y - tipR - coneLen * 0.85);
	const pillarTopY = coneBaseY;
	// The column reaches the plate, so clearance includes the part inside the raft.
	const pillarBotY = 0;

	const outward = outwardXz(contact, normal, dieCentroidXz);
	const headHeight = Math.max(1e-3, contact.y - coneBaseY);
	const minLean = (Math.min(MIN_HEAD_LEAN_DEG, settings.maxHeadLeanDeg) * Math.PI) / 180;
	const maxLean = (settings.maxHeadLeanDeg * Math.PI) / 180;
	const minOffset = Math.tan(minLean) * headHeight;
	const maxOffset = Math.tan(maxLean) * headHeight;
	const clearOffset = Math.min(20, Math.tan((CLEARANCE_LEAN_DEG * Math.PI) / 180) * headHeight);
	const nLen = normal.length();
	const faceNormal = nLen > 1e-8 ? normal.clone().multiplyScalar(1 / nLen) : undefined;

	const faceOk = (dir: Vector3, dist: number): boolean =>
		headClearsFace(
			contact,
			faceNormal,
			contact.x + dir.x * dist,
			contact.z + dir.z * dist,
			coneBaseY,
			settings
		);

	const bodyOk = (dir: Vector3, dist: number): boolean => {
		if (!diePrint || pillarTopY <= pillarBotY + 1e-6) return true;
		const fx = contact.x + dir.x * dist;
		const fz = contact.z + dir.z * dist;
		if (columnHitsDie(diePrint, fx, fz, pillarBotY, pillarTopY, pillarR + BODY_CLEARANCE_MM)) {
			return false;
		}
		return !coneHitsDie(diePrint, contact, fx, fz, coneBaseY, settings);
	};

	const scan = (dir: Vector3, limit: number, requireFace: boolean): number | undefined => {
		const cap = Math.max(limit, minOffset);
		for (let i = 0; i <= LEAN_STEPS; i++) {
			const dist = minOffset + ((cap - minOffset) * i) / LEAN_STEPS;
			if (requireFace && !faceOk(dir, dist)) continue;
			if (bodyOk(dir, dist)) return dist;
		}
		return undefined;
	};

	const place = (dir: Vector3, dist: number): FootPlacement => ({
		contact: contact.clone(),
		footX: contact.x + dir.x * dist,
		footZ: contact.z + dir.z * dist,
		coneBaseY
	});

	const fanStep = (FAN_STEP_DEG * Math.PI) / 180;
	const fanLimit = Math.round(180 / FAN_STEP_DEG);
	const search = (requireFace: boolean): FootPlacement | undefined => {
		const alongNormal = scan(outward, maxOffset, requireFace);
		if (alongNormal !== undefined) return place(outward, alongNormal);

		for (let k = 1; k <= fanLimit; k++) {
			for (const sign of [1, -1]) {
				const dir = rotateXz(outward, sign * k * fanStep);
				const dist = scan(dir, maxOffset, requireFace);
				if (dist !== undefined) return place(dir, dist);
			}
		}

		// Still buried: allow a longer reach than the lean setting, normal first.
		if (clearOffset > maxOffset + 0.05) {
			const further = scan(outward, clearOffset, requireFace);
			if (further !== undefined) return place(outward, further);
			for (let k = 1; k <= fanLimit; k++) {
				for (const sign of [1, -1]) {
					const dir = rotateXz(outward, sign * k * fanStep);
					const dist = scan(dir, clearOffset, requireFace);
					if (dist !== undefined) return place(dir, dist);
				}
			}
		}
		return undefined;
	};

	// Prefer a head steep enough to miss the face. If that aim is buried in
	// another lobe, keep the placement that at least clears the body.
	return search(true) ?? search(false) ?? place(outward, maxOffset);
}

function rotateXz(dir: Vector3, ang: number): Vector3 {
	const c = Math.cos(ang);
	const s = Math.sin(ang);
	return new Vector3(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
}

/**
 * Cone tip radius. Taken from the pillar, then capped so the tip disk lies
 * inside the contact sphere. A rim wider than the sphere crosses the face at
 * every head angle.
 */
function coneTipRadiusMm(pillarR: number, tipR: number): number {
	const fromPillar = Math.max(0.08, pillarR * CONE_TIP_PILLAR_FRACTION);
	const bury = tipR * CONE_PIERCE_FRACTION;
	const fit = Math.sqrt(Math.max(0, tipR * tipR - bury * bury));
	if (fromPillar <= fit * 0.92) return fromPillar;
	return Math.max(0.02, fit * 0.92);
}

type RadiusSpan = { t0: number; r0: number; t1: number; r1: number };

/**
 * Outer radius of the neck and taper along the head axis.
 * `t` is distance from the tip-sphere centre toward the foot.
 */
function headOuterSpans(settings: SupportSettings, axisLength: number): Array<RadiusSpan> {
	const pillarR = Math.max(0, settings.pillarDiameterMm / 2);
	const tipR = Math.max(1e-3, settings.sphereDiameterMm / 2);
	const rTip = coneTipRadiusMm(pillarR, tipR);
	const fullLen = Math.max(1e-4, axisLength);
	const tipDist = Math.max(rTip, fullLen - tipR * CONE_PIERCE_FRACTION);
	const tTip = Math.max(0, fullLen - tipDist);
	const stubLen = Math.min(pillarR, Math.max(0, tipDist - MIN_TAPER_MM));
	const tNeck = fullLen - stubLen;
	// Wide end of the taper sits overlap-deep into the neck, toward the foot.
	const tWide = fullLen - (stubLen - CONE_PILLAR_OVERLAP_MM);
	const spans: Array<RadiusSpan> = [];
	const taperEndT = stubLen > MIN_NECK_MM ? tNeck : Math.min(fullLen, Math.max(tTip, tWide));
	const denom = tWide - tTip;
	const taperEndR = denom > 1e-9 ? rTip + (pillarR - rTip) * ((taperEndT - tTip) / denom) : rTip;
	if (taperEndT > tTip + 1e-6) {
		spans.push({ t0: tTip, r0: rTip, t1: taperEndT, r1: taperEndR });
	}
	if (stubLen > MIN_NECK_MM && fullLen > tNeck + 1e-6) {
		spans.push({ t0: tNeck, r0: pillarR, t1: fullLen, r1: pillarR });
	}
	return spans;
}

/** Angle from the face at which a head cross-section of radius `r` at distance `t` stays `margin` off the plane. */
function stationFaceAngle(t: number, r: number, tipR: number, margin: number): number {
	if (t <= 1e-8) return Math.PI / 2;
	const radial = Math.max(0, r);
	const reach = Math.hypot(t, radial);
	// Inside the tip sphere the head may cross the face; the sphere covers it.
	if (reach < tipR - 1e-4) return 0;
	// Straight into the face the near side sits at height `t`. Closer than the
	// margin cannot clear, whatever the lean.
	if (t <= margin) return Math.PI / 2;
	const phi = Math.atan2(radial, t);
	const delta = Math.asin(Math.min(1, margin / reach));
	return Math.min(Math.PI / 2, phi + delta);
}

function spanFaceAngle(span: RadiusSpan, tipR: number, margin: number): number {
	const { t0, r0, t1, r1 } = span;
	if (!(t1 > t0 + 1e-9)) return stationFaceAngle(t0, r0, tipR, margin);
	const slope = (r1 - r0) / (t1 - t0);
	const radiusAt = (t: number) => r0 + slope * (t - t0);
	const outsideSphere = (t: number) => {
		const radial = radiusAt(t);
		return t * t + radial * radial >= tipR * tipR;
	};
	let tLo = t0;
	if (!outsideSphere(t0)) {
		if (!outsideSphere(t1)) return 0;
		let lo = t0;
		let hi = t1;
		for (let i = 0; i < 32; i++) {
			const mid = (lo + hi) / 2;
			if (outsideSphere(mid)) hi = mid;
			else lo = mid;
		}
		tLo = hi;
	}
	let beta = 0;
	const steps = 8;
	for (let i = 0; i <= steps; i++) {
		const t = tLo + ((t1 - tLo) * i) / steps;
		beta = Math.max(beta, stationFaceAngle(t, radiusAt(t), tipR, margin));
	}
	return beta;
}

/**
 * Smallest angle between the head axis and the contact face such that the neck
 * and taper stay off the face except inside the tip sphere.
 */
export function minHeadFaceAngleRad(settings: SupportSettings, axisLength: number): number {
	const tipR = Math.max(1e-3, settings.sphereDiameterMm / 2);
	const margin = FACE_ATTACH_CLEARANCE_MM;
	let beta = 0;
	for (const span of headOuterSpans(settings, axisLength)) {
		beta = Math.max(beta, spanFaceAngle(span, tipR, margin));
	}
	// Joint sphere at the foot extends a full pillar radius toward the face,
	// not only sideways off the axis.
	const pillarR = Math.max(0, settings.pillarDiameterMm / 2);
	const footNeed = (pillarR + margin) / Math.max(axisLength, 1e-4);
	if (footNeed >= 1) beta = Math.PI / 2;
	else beta = Math.max(beta, Math.asin(Math.max(0, footNeed)));
	return Math.min(Math.PI / 2, beta);
}

function headClearsFace(
	contact: Vector3,
	faceNormal: Vector3 | undefined,
	footX: number,
	footZ: number,
	coneBaseY: number,
	settings: SupportSettings
): boolean {
	if (!faceNormal) return true;
	const dx = footX - contact.x;
	const dy = coneBaseY - contact.y;
	const dz = footZ - contact.z;
	const len = Math.hypot(dx, dy, dz);
	if (len < 1e-4) return false;
	const along = (dx * faceNormal.x + dy * faceNormal.y + dz * faceNormal.z) / len;
	return along + 1e-4 >= Math.sin(minHeadFaceAngleRad(settings, len));
}

function columnHitsDie(
	die: Manifold,
	x: number,
	z: number,
	y0: number,
	y1: number,
	radius: number
): boolean {
	const h = y1 - y0;
	if (h <= 1e-6 || radius <= 0) return false;
	const wasm = manifold();
	// Manifold cylinder is along +Z; −90° about X maps +Z → +Y.
	const cyl = mapOwned(
		wasm.Manifold.cylinder(h, radius, radius, 12, false),
		(m) => m.rotate([-90, 0, 0]),
		(m) => m.translate([x, y0, z])
	);
	const hit = wasm.Manifold.intersection(die, cyl);
	const vol = hit.volume();
	hit.delete();
	cyl.delete();
	return vol > PROBE_CLEAR_VOL;
}

/**
 * The tapered head from the foot up to just outside the tip sphere. The sphere
 * itself is meant to embed in the face, so that last stretch is not a hit.
 */
function coneHitsDie(
	die: Manifold,
	contact: Vector3,
	footX: number,
	footZ: number,
	coneBaseY: number,
	settings: SupportSettings
): boolean {
	const pillarR = settings.pillarDiameterMm / 2;
	const tipR = Math.max(1e-3, settings.sphereDiameterMm / 2);
	const coneTipR = coneTipRadiusMm(pillarR, tipR);
	const foot = new Vector3(footX, coneBaseY, footZ);
	const toContact = new Vector3().subVectors(contact, foot);
	const fullLen = toContact.length();
	if (fullLen < 1e-4) return false;
	// Stop short of the tip sphere by the clearance gap. The probe is fat at the
	// foot and tapers to the real tip radius, so the head can still reach the
	// face while the shaft stays off the body.
	const stop = fullLen - tipR - BODY_CLEARANCE_MM;
	if (stop < 0.3) return false;
	const wasm = manifold();
	const cone = wasm.Manifold.cylinder(stop, pillarR + BODY_CLEARANCE_MM, coneTipR, 10, false);
	const oriented = orientCylinderZTo(cone, foot, toContact.multiplyScalar(stop / fullLen));
	const hit = wasm.Manifold.intersection(die, oriented);
	oriented.delete();
	const vol = hit.volume();
	hit.delete();
	return vol > PROBE_CLEAR_VOL;
}

/**
 * How far above the cone-junction Y the vertical pillar must extend so an
 * angled plane through the junction still cuts the whole cylinder cross-section
 * (fills the "broken back" notch under a leaning cone).
 */
export function pillarMiterOverhangMm(coneDirUnit: Vector3, pillarR: number): number {
	const horiz = Math.hypot(coneDirUnit.x, coneDirUnit.z);
	const up = Math.max(1e-6, Math.abs(coneDirUnit.y));
	return pillarR * (horiz / up) + 0.12;
}

/** One support: vertical pillar from the plate, joint sphere, short angled neck, then the tapering cone. The raft is built once for every foot. */
export function buildSingleSupportManifold(
	foot: FootPlacement,
	settings: SupportSettings
): Manifold {
	const wasm = manifold();
	const pillarR = settings.pillarDiameterMm / 2;
	const tipR = Math.max(1e-3, settings.sphereDiameterMm / 2);
	// Cone tip is sized from the pillar, never from the sphere.
	const coneTipR = coneTipRadiusMm(pillarR, tipR);
	const parts: Manifold[] = [];

	// Distinct tip sphere centred on the face contact (half embeds into the die).
	// Edge contacts are inset by ≥ tipR + margin so this never reaches the edge.
	parts.push(
		mapOwned(wasm.Manifold.sphere(tipR, SPHERE_SEGMENTS), (m) =>
			m.translate([foot.contact.x, foot.contact.y, foot.contact.z])
		)
	);

	const coneBot = new Vector3(foot.footX, foot.coneBaseY, foot.footZ);
	const toContact = new Vector3().subVectors(foot.contact, coneBot);
	const fullLen = toContact.length();
	let coneDir = new Vector3(0, 1, 0);
	if (fullLen > 1e-4) {
		coneDir = toContact.clone().multiplyScalar(1 / fullLen);

		// Cone tip ends inside the tip sphere (pierces it).
		const tipDist = Math.max(coneTipR, fullLen - tipR * CONE_PIERCE_FRACTION);
		const coneTip = coneBot.clone().addScaledVector(coneDir, tipDist);

		// Sphere centred on the pillar top. Its equator is the pillar rim, and a
		// great circle in the cone's base plane is the stub's base, so both
		// cylinders meet the ball on a shared tangent circle.
		parts.push(
			mapOwned(wasm.Manifold.sphere(pillarR, CYL_SEGMENTS), (m) =>
				m.translate([coneBot.x, coneBot.y, coneBot.z])
			)
		);

		// Stub is only one sphere-radius long: base at the ball centre, same
		// radius, already aimed along the cone. The taper starts at its end.
		const stubLen = Math.min(pillarR, Math.max(0, tipDist - MIN_TAPER_MM));
		const neckEnd = coneBot.clone().addScaledVector(coneDir, stubLen);
		if (stubLen > MIN_NECK_MM) {
			const neckVec = coneDir.clone().multiplyScalar(stubLen);
			const neck = wasm.Manifold.cylinder(stubLen, pillarR, pillarR, CYL_SEGMENTS, false);
			parts.push(orientCylinderZTo(neck, coneBot, neckVec));
		}

		const coneStart = neckEnd.clone().addScaledVector(coneDir, -CONE_PILLAR_OVERLAP_MM);
		const coneVec = new Vector3().subVectors(coneTip, coneStart);
		const coneH = coneVec.length();
		if (coneH > 1e-4) {
			const cone = wasm.Manifold.cylinder(coneH, pillarR, coneTipR, CYL_SEGMENTS, false);
			parts.push(orientCylinderZTo(cone, coneStart, coneVec));
		}
	}

	// Vertical pillar runs from the plate to the ball's centre. The ball covers
	// the top, and the angled stub leaves that ball along a great circle. The
	// shared raft is unioned afterwards and the column passes through it.
	const pillarH = foot.coneBaseY;
	if (pillarH > 1e-4) {
		parts.push(
			mapOwned(
				wasm.Manifold.cylinder(pillarH, pillarR, pillarR, CYL_SEGMENTS, false),
				(m) => m.rotate([-90, 0, 0]),
				(m) => m.translate([foot.footX, 0, foot.footZ])
			)
		);
	}

	if (parts.length === 1) {
		return parts[0];
	}
	const u = wasm.Manifold.union(parts);
	deleteAll(...parts);
	return u;
}

/**
 * How many pillars to boolean together before reporting progress. Large enough
 * that the batch stays inside Manifold's n-way union; small enough that a few
 * hundred pillars produce a visible series of ticks.
 */
const UNION_BATCH = 24;

function countUnionSteps(n: number, batch: number): number {
	let steps = 0;
	let count = n;
	while (count > 1) {
		let next = 0;
		for (let i = 0; i < count; i += batch) {
			if (Math.min(batch, count - i) > 1) {
				steps += 1;
			}
			next += 1;
		}
		count = next;
	}
	return steps;
}

/** Union pillar solids, reporting each batch. A single part is returned as-is. */
function unionSupportParts(
	parts: Array<Manifold>,
	cancel: SupportCancelToken | undefined,
	onProgress: SupportProgressFn | undefined
): Manifold {
	if (parts.length <= 1) {
		return parts[0];
	}
	const wasm = manifold();
	const total = countUnionSteps(parts.length, UNION_BATCH);
	let step = 0;
	const report = () => {
		onProgress?.('supports-union', step / Math.max(1, total), `${step}/${total}`, {
			step,
			total
		});
	};
	// step 0 lets the progress die start a fresh roll for this phase.
	report();
	let level = parts;
	while (level.length > 1) {
		const next: Array<Manifold> = [];
		for (let i = 0; i < level.length; i += UNION_BATCH) {
			assertNotCancelled(cancel);
			const group = level.slice(i, i + UNION_BATCH);
			if (group.length === 1) {
				next.push(group[0]);
				continue;
			}
			const u = wasm.Manifold.union(group);
			deleteAll(...group);
			next.push(u);
			step += 1;
			report();
		}
		level = next;
	}
	return level[0];
}

/** Rotate a +Z cylinder (base at origin) so it runs from `origin` along `dir`. */
function orientCylinderZTo(cyl: Manifold, origin: Vector3, dir: Vector3): Manifold {
	const d = dir.clone().normalize();
	const x = new Vector3();
	const y = new Vector3();
	if (Math.abs(d.y) < 0.9) {
		x.crossVectors(new Vector3(0, 1, 0), d).normalize();
	} else {
		x.crossVectors(new Vector3(1, 0, 0), d).normalize();
	}
	y.crossVectors(d, x).normalize();
	const m: Array<number> = [
		x.x,
		x.y,
		x.z,
		0,
		y.x,
		y.y,
		y.z,
		0,
		d.x,
		d.y,
		d.z,
		0,
		origin.x,
		origin.y,
		origin.z,
		1
	];
	const out = cyl.transform(m as unknown as import('../manifold').Mat4);
	cyl.delete();
	return out;
}

export type BuildSupportsResult = {
	manifold: Manifold;
	mesh: Mesh;
	contactCount: number;
};

/**
 * One support solid at a time, pillars first then the tip post. Each yielded
 * manifold is owned by the caller. Preview draws these individually; export
 * collects them and unions. Feet are recorded so the caller can build one raft.
 */
export function* iterateSupportSolids(
	regions: SupportRegions,
	settings: SupportSettings,
	diePrint: Manifold | undefined,
	cancel?: SupportCancelToken,
	feetOut?: Array<RaftFoot>
): Generator<Manifold> {
	const contacts = sampleSupportContacts(regions, settings);
	if (contacts.length === 0 && !regions.tipPost) {
		return;
	}

	let cx = 0;
	let cz = 0;
	if (contacts.length > 0) {
		for (const c of contacts) {
			cx += c.point.x;
			cz += c.point.z;
		}
		cx /= contacts.length;
		cz /= contacts.length;
	} else if (regions.tipPost) {
		cx = regions.tipPost.apex.x;
		cz = regions.tipPost.apex.z;
	}

	const pillarR = settings.pillarDiameterMm / 2;
	for (const c of contacts) {
		assertNotCancelled(cancel);
		const foot = placeSupportFoot(c.point, c.normal, settings, diePrint, { x: cx, z: cz });
		feetOut?.push({ x: foot.footX, z: foot.footZ, radius: pillarR });
		yield buildSingleSupportManifold(foot, settings);
	}
	if (regions.tipPost) {
		assertNotCancelled(cancel);
		const postR = Math.max(0.1, settings.postDiameterMm / 2);
		feetOut?.push({
			x: regions.tipPost.apex.x,
			z: regions.tipPost.apex.z,
			radius: postR
		});
		yield buildTipPostManifold(regions.tipPost, settings);
	}
}

/** Triangle mesh for one support solid. Deletes `solid`. */
export function meshFromSupportSolid(solid: Manifold): Mesh {
	const mesh = new Mesh(manifoldToGeometry(solid), _material);
	solid.delete();
	return mesh;
}

/**
 * Build the unioned support solid for a die. `diePrint` should be the die (or
 * blank) already transformed into print space; it is borrowed (not deleted).
 * Export wants one manifold; the editor preview uses `iterateSupportSolids`
 * and draws each support on its own.
 */
export function buildSupportsManifold(
	regions: SupportRegions,
	settings: SupportSettings,
	diePrint: Manifold | undefined,
	opts: { cancel?: SupportCancelToken; onProgress?: SupportProgressFn } = {}
): BuildSupportsResult | undefined {
	const { cancel, onProgress } = opts;
	const contacts = sampleSupportContacts(regions, settings);
	const totalSteps = contacts.length + (regions.tipPost ? 1 : 0);
	if (totalSteps === 0) {
		return undefined;
	}

	const reportBuilt = (step: number) => {
		onProgress?.('supports-solid', step / Math.max(1, totalSteps), `${step}/${totalSteps}`, {
			step,
			total: totalSteps
		});
	};

	const parts: Manifold[] = [];
	const feet: Array<RaftFoot> = [];
	let acc: Manifold | undefined;
	let built = 0;
	reportBuilt(0);

	// Union every batch as we go. Holding every pillar until the end, on top of
	// the numbered-die solid already in the WASM heap, is what trips
	// "memory access out of bounds" partway through a set.
	const flushPending = () => {
		if (parts.length === 0) {
			return;
		}
		const batch = parts.splice(0);
		const united = unionSupportParts(batch, cancel, onProgress);
		if (!acc) {
			acc = united;
			return;
		}
		try {
			const next = manifold().Manifold.union([acc, united]);
			deleteAll(acc, united);
			acc = next;
		} catch (e) {
			deleteAll(acc, united);
			acc = undefined;
			throw e;
		}
	};

	try {
		for (const solid of iterateSupportSolids(regions, settings, diePrint, cancel, feet)) {
			parts.push(solid);
			built += 1;
			reportBuilt(built);
			if (parts.length >= UNION_BATCH) {
				flushPending();
			}
		}
		flushPending();
		const raft = buildSupportRaft(
			feet,
			Math.max(0, settings.raftDepthMm),
			Math.max(0.5, settings.raftSizeMm)
		);
		if (raft) {
			if (!acc) {
				acc = raft;
			} else {
				try {
					const next = manifold().Manifold.union([acc, raft]);
					deleteAll(acc, raft);
					acc = next;
				} catch (e) {
					deleteAll(acc, raft);
					acc = undefined;
					throw e;
				}
			}
		}
	} catch (e) {
		deleteAll(...parts);
		if (acc) {
			try {
				acc.delete();
			} catch {
				// flush already deleted it while handling its own failure
			}
		}
		throw e;
	}

	if (!acc) {
		return undefined;
	}

	onProgress?.('supports-mesh');
	const geo = manifoldToGeometry(acc);
	return {
		manifold: acc,
		mesh: new Mesh(geo, _material),
		contactCount: totalSteps
	};
}

/** Clone a print-space die manifold for support placement probes. */
export function borrowDiePrintClone(diePrint: Manifold): Manifold {
	return cloneManifold(diePrint);
}
