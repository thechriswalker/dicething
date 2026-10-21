// Tip-down apex post: bottom half is a cylinder stump; top half continues as
// thin rectangular fins (center → circumference) that rise straight up into the
// die. Union with the die handles contact — no edge-angle math. Detection in
// regions.ts.

import { Vector3 } from 'three';
import { deleteAll, manifold, type Manifold, type Mat4 } from '../manifold';
import type { SupportSettings, SupportTipPost } from './types';

const CYL_SEGMENTS = 24;

/**
 * Bottom 50% of tip clearance = cylinder; top 50% = rectangular radial fins
 * that continue out of the stump (inner @ center, outer @ circumference) and
 * enter the die so contact is just the boolean intersection.
 */
export function buildTipPostManifold(tip: SupportTipPost, settings: SupportSettings): Manifold {
	const wasm = manifold();
	const postR = Math.max(0.1, settings.postDiameterMm / 2);
	const finT = Math.max(0.05, settings.postFinThicknessMm);
	const raft = Math.max(0, settings.raftDepthMm);
	const tipY = Math.max(raft + 0.5, tip.apex.y);
	const ax = tip.apex.x;
	const az = tip.apex.z;

	// Clearance column from plate/raft up to the tip — split 50/50.
	const H = tipY - raft;
	const cylTop = raft + H * 0.5;

	const parts: Manifold[] = [];

	const cylH = cylTop - raft;
	if (cylH > 1e-4) {
		parts.push(
			wasm.Manifold.cylinder(cylH, postR, postR, CYL_SEGMENTS, false)
				.rotate([-90, 0, 0])
				.translate([ax, raft, az])
		);
	}

	// Fins start inside the cylinder (seamless union) and rise past the tip so
	// they enter the die; contact is wherever the rectangles intersect it.
	const overlap = Math.min(0.25, cylH * 0.5);
	const finBottom = Math.max(raft, cylTop - overlap);
	const finTop = tipY + H * 0.5;
	const finH = finTop - finBottom;

	if (finH > 1e-4) {
		for (const d of tip.edgeDirs) {
			const horiz = new Vector3(d.x, 0, d.z);
			if (horiz.lengthSq() < 1e-10) continue;
			horiz.normalize();
			const thin = new Vector3(-horiz.z, 0, horiz.x);
			const up = new Vector3(0, 1, 0);

			// Unit cube along +X/+Y/+Z: radial × height × thickness, then map
			// +X→horiz (center→rim), +Y→up, +Z→thin (centered on the plane).
			const box = wasm.Manifold.cube([postR, finH, finT], false).translate([
				0,
				0,
				-finT / 2
			]);
			const m: number[] = [
				horiz.x,
				horiz.y,
				horiz.z,
				0,
				up.x,
				up.y,
				up.z,
				0,
				thin.x,
				thin.y,
				thin.z,
				0,
				ax,
				finBottom,
				az,
				1
			];
			parts.push(box.transform(m as unknown as Mat4));
		}
	}

	if (raft > 1e-6) {
		const padR = Math.max(settings.raftSizeMm, postR + 0.5);
		parts.push(
			wasm.Manifold.cylinder(raft, padR, padR, 6, false)
				.rotate([-90, 0, 0])
				.translate([ax, 0, az])
		);
	}

	if (parts.length === 0) {
		return wasm.Manifold.cylinder(0.5, postR, postR, CYL_SEGMENTS, false)
			.rotate([-90, 0, 0])
			.translate([ax, 0, az]);
	}
	if (parts.length === 1) {
		return parts[0];
	}
	const u = wasm.Manifold.union(parts);
	deleteAll(...parts);
	return u;
}
