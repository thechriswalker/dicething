// Build SLA support solids from SupportRegions: vertical pillars, angled cones,
// tip spheres the cone pierces into, and per-pillar hexagonal raft pads on y = 0.
//
// Coordinates are print space (Y-up). The die manifold (also print-oriented) is
// used only to lean pillars clear of the body; supports are never booleaned into
// the die.

import { Mesh, MeshNormalMaterial, Vector3 } from 'three';
import { cloneManifold, deleteAll, manifold, manifoldToGeometry, type Manifold } from '../manifold';
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

const CYL_SEGMENTS = 16;
const RAFT_SEGMENTS = 6; // hexagonal pads
const SPHERE_SEGMENTS = 12;
const LEAN_STEPS = 12;
const PROBE_CLEAR_VOL = 1e-5;
/**
 * Air gap the pillar and cone must keep from the die. The tip sphere is allowed
 * to meet the face; this margin applies to the support body only.
 */
const BODY_CLEARANCE_MM = 0.5;
/** How far past the user's max lean a foot may go when that is what clears the die. */
const CLEARANCE_LEAN_DEG = 75;
const FAN_STEP_DEG = 15;
/** Minimum cone lean so the head always angles toward the die (degrees). */
const MIN_HEAD_LEAN_DEG = 18;
/**
 * Cone tip radius as a fraction of the pillar radius. Independent of the
 * contact-sphere diameter — the cone pierces into the sphere rather than
 * matching its size.
 */
const CONE_TIP_PILLAR_FRACTION = 0.28;
/** How far the cone tip sits past the sphere surface toward its centre (× tipR). */
const CONE_PIERCE_FRACTION = 0.55;
/** Extra overlap of cone into the mitered pillar so the union seals. */
const CONE_PILLAR_OVERLAP_MM = 0.08;

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
 * tips back toward the face. On a concave outline that normal can point into
 * another lobe; the foot then turns, and if needed leans past the usual limit,
 * until the pillar and the cone both sit clear of the die.
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
	const pillarBotY = raft;

	const outward = outwardXz(contact, normal, dieCentroidXz);
	const headHeight = Math.max(1e-3, contact.y - coneBaseY);
	const minLean = (Math.min(MIN_HEAD_LEAN_DEG, settings.maxHeadLeanDeg) * Math.PI) / 180;
	const maxLean = (settings.maxHeadLeanDeg * Math.PI) / 180;
	const minOffset = Math.tan(minLean) * headHeight;
	const maxOffset = Math.tan(maxLean) * headHeight;
	const clearOffset = Math.min(20, Math.tan((CLEARANCE_LEAN_DEG * Math.PI) / 180) * headHeight);

	const misses = (dir: Vector3, dist: number): boolean => {
		if (!diePrint || pillarTopY <= pillarBotY + 1e-6) return true;
		const fx = contact.x + dir.x * dist;
		const fz = contact.z + dir.z * dist;
		if (columnHitsDie(diePrint, fx, fz, pillarBotY, pillarTopY, pillarR + BODY_CLEARANCE_MM)) {
			return false;
		}
		return !coneHitsDie(diePrint, contact, fx, fz, coneBaseY, settings);
	};

	const scan = (dir: Vector3, limit: number): number | undefined => {
		const cap = Math.max(limit, minOffset);
		for (let i = 0; i <= LEAN_STEPS; i++) {
			const dist = minOffset + ((cap - minOffset) * i) / LEAN_STEPS;
			if (misses(dir, dist)) return dist;
		}
		return undefined;
	};

	const place = (dir: Vector3, dist: number): FootPlacement => ({
		contact: contact.clone(),
		footX: contact.x + dir.x * dist,
		footZ: contact.z + dir.z * dist,
		coneBaseY
	});

	const alongNormal = scan(outward, maxOffset);
	if (alongNormal !== undefined) return place(outward, alongNormal);

	const fanStep = (FAN_STEP_DEG * Math.PI) / 180;
	for (let k = 1; k <= Math.round(180 / FAN_STEP_DEG); k++) {
		for (const sign of [1, -1]) {
			const dir = rotateXz(outward, sign * k * fanStep);
			const dist = scan(dir, maxOffset);
			if (dist !== undefined) return place(dir, dist);
		}
	}

	// Still buried: allow a longer reach than the lean setting, normal first.
	if (clearOffset > maxOffset + 0.05) {
		const further = scan(outward, clearOffset);
		if (further !== undefined) return place(outward, further);
		for (let k = 1; k <= Math.round(180 / FAN_STEP_DEG); k++) {
			for (const sign of [1, -1]) {
				const dir = rotateXz(outward, sign * k * fanStep);
				const dist = scan(dir, clearOffset);
				if (dist !== undefined) return place(dir, dist);
			}
		}
	}

	return place(outward, maxOffset);
}

function rotateXz(dir: Vector3, ang: number): Vector3 {
	const c = Math.cos(ang);
	const s = Math.sin(ang);
	return new Vector3(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
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
	const cyl = wasm.Manifold.cylinder(h, radius, radius, 12, false)
		.rotate([-90, 0, 0])
		.translate([x, y0, z]);
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
	const coneTipR = Math.max(0.08, pillarR * CONE_TIP_PILLAR_FRACTION);
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

/** One support: hexagonal raft, vertical pillar, joint sphere, short angled neck, then the tapering cone. */
export function buildSingleSupportManifold(
	foot: FootPlacement,
	settings: SupportSettings
): Manifold {
	const wasm = manifold();
	const pillarR = settings.pillarDiameterMm / 2;
	const tipR = Math.max(1e-3, settings.sphereDiameterMm / 2);
	// Cone tip is sized from the pillar, never from the sphere.
	const coneTipR = Math.max(0.08, pillarR * CONE_TIP_PILLAR_FRACTION);
	const raft = Math.max(0, settings.raftDepthMm);
	const parts: Manifold[] = [];

	// Distinct tip sphere centred on the face contact (half embeds into the die).
	// Edge contacts are inset by ≥ tipR + margin so this never reaches the edge.
	parts.push(
		wasm.Manifold.sphere(tipR, SPHERE_SEGMENTS).translate([
			foot.contact.x,
			foot.contact.y,
			foot.contact.z
		])
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
			wasm.Manifold.sphere(pillarR, CYL_SEGMENTS).translate([coneBot.x, coneBot.y, coneBot.z])
		);

		// Stub is only one sphere-radius long: base at the ball centre, same
		// radius, already aimed along the cone. The taper starts at its end.
		const stubLen = Math.min(pillarR, Math.max(0, tipDist - 0.35));
		const neckEnd = coneBot.clone().addScaledVector(coneDir, stubLen);
		if (stubLen > 0.02) {
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

	// Vertical pillar stops at the ball's centre. The ball covers the top, and
	// the angled stub leaves that ball along a great circle.
	const pillarH = foot.coneBaseY - raft;
	if (pillarH > 1e-4) {
		parts.push(
			wasm.Manifold.cylinder(pillarH, pillarR, pillarR, CYL_SEGMENTS, false)
				.rotate([-90, 0, 0])
				.translate([foot.footX, raft, foot.footZ])
		);
	}

	// Per-pillar hexagonal raft; raftSizeMm is the apothem/radius.
	if (raft > 1e-6) {
		const padR = Math.max(0.5, settings.raftSizeMm);
		parts.push(
			wasm.Manifold.cylinder(raft, padR, padR, RAFT_SEGMENTS, false)
				.rotate([-90, 0, 0])
				.translate([foot.footX, 0, foot.footZ])
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
 * collects them and unions.
 */
export function* iterateSupportSolids(
	regions: SupportRegions,
	settings: SupportSettings,
	diePrint: Manifold | undefined,
	cancel?: SupportCancelToken
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

	for (const c of contacts) {
		assertNotCancelled(cancel);
		const foot = placeSupportFoot(c.point, c.normal, settings, diePrint, { x: cx, z: cz });
		yield buildSingleSupportManifold(foot, settings);
	}
	if (regions.tipPost) {
		assertNotCancelled(cancel);
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
	reportBuilt(0);
	try {
		for (const solid of iterateSupportSolids(regions, settings, diePrint, cancel)) {
			parts.push(solid);
			reportBuilt(parts.length);
		}
	} catch (e) {
		deleteAll(...parts);
		throw e;
	}

	assertNotCancelled(cancel);
	// One n-way union of every pillar is the long pause after the per-support
	// loop. Batch it so the UI can tick; each batch still uses Manifold's own
	// union, which only does real booleans where the pieces overlap.
	const result = unionSupportParts(parts, cancel, onProgress);

	onProgress?.('supports-mesh');
	const geo = manifoldToGeometry(result);
	return {
		manifold: result,
		mesh: new Mesh(geo, _material),
		contactCount: totalSteps
	};
}

/** Clone a print-space die manifold for support placement probes. */
export function borrowDiePrintClone(diePrint: Manifold): Manifold {
	return cloneManifold(diePrint);
}
