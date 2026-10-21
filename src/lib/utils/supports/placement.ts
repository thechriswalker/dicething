// Lightweight Three.js overlays for support placement preview (no Manifold).

import {
	BufferGeometry,
	CylinderGeometry,
	Float32BufferAttribute,
	Group,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	SphereGeometry,
	Vector3
} from 'three';
import { sampleSupportContacts } from './geometry';
import type { SupportRegions, SupportSettings } from './types';

const lineMat = new LineBasicMaterial({ color: 0x33cc66 });
const pointMat = new MeshBasicMaterial({ color: 0xffaa00 });
const legendMat = new MeshBasicMaterial({ color: 0x4488ff });
const tipMat = new MeshBasicMaterial({ color: 0xcc66ff, transparent: true, opacity: 0.55 });
const tipFinMat = new LineBasicMaterial({ color: 0xcc66ff });

/**
 * Build a scene group showing edge lines and contact markers in print space.
 * Caller owns the group and should dispose geometries on remove.
 */
export function buildPlacementOverlay(
	regions: SupportRegions,
	settings: SupportSettings
): Group {
	const group = new Group();
	group.name = 'supports-placement';

	const positions: number[] = [];
	for (const line of regions.edgeLines) {
		for (let i = 0; i < line.points.length - 1; i++) {
			const a = line.points[i];
			const b = line.points[i + 1];
			positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
		}
	}
	if (positions.length > 0) {
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
		group.add(new LineSegments(geo, lineMat));
	}

	const contacts = sampleSupportContacts(regions, settings);
	const r = Math.max(1e-3, settings.sphereDiameterMm / 2);
	for (const c of contacts) {
		const mesh = new Mesh(new SphereGeometry(r, 8, 6), c.source === 'legend' ? legendMat : pointMat);
		mesh.position.copy(c.point);
		group.add(mesh);
	}

	if (regions.tipPost) {
		const tip = regions.tipPost;
		const postR = settings.postDiameterMm / 2;
		const raft = Math.max(0, settings.raftDepthMm);
		const tipY = Math.max(raft + 0.5, tip.apex.y);
		const H = tipY - raft;
		const cylTop = raft + H * 0.5;
		const cylH = cylTop - raft;
		if (cylH > 1e-4) {
			const cyl = new Mesh(new CylinderGeometry(postR, postR, cylH, 16), tipMat);
			cyl.position.set(tip.apex.x, raft + cylH / 2, tip.apex.z);
			group.add(cyl);
		}
		// Rectangular fins: center → rim, rising from cyl top into the die.
		const finPos: number[] = [];
		const finTop = tipY + H * 0.5;
		for (const d of tip.edgeDirs) {
			const horiz = new Vector3(d.x, 0, d.z);
			if (horiz.lengthSq() < 1e-10) continue;
			horiz.normalize();
			const c0 = new Vector3(tip.apex.x, cylTop, tip.apex.z);
			const c1 = new Vector3(tip.apex.x, finTop, tip.apex.z);
			const r0 = new Vector3(
				tip.apex.x + horiz.x * postR,
				cylTop,
				tip.apex.z + horiz.z * postR
			);
			const r1 = new Vector3(
				tip.apex.x + horiz.x * postR,
				finTop,
				tip.apex.z + horiz.z * postR
			);
			const push = (a: Vector3, b: Vector3) => {
				finPos.push(a.x, a.y, a.z, b.x, b.y, b.z);
			};
			push(c0, c1);
			push(r0, r1);
			push(c0, r0);
			push(c1, r1);
		}
		if (finPos.length > 0) {
			const geo = new BufferGeometry();
			geo.setAttribute('position', new Float32BufferAttribute(finPos, 3));
			group.add(new LineSegments(geo, tipFinMat));
		}
	}

	return group;
}

export function disposeOverlayGroup(group: Group): void {
	group.traverse((o) => {
		const mesh = o as Mesh;
		if (mesh.isMesh || (o as LineSegments).isLineSegments) {
			const g = (o as Mesh).geometry;
			g?.dispose();
		}
	});
	group.clear();
}

/** Serialize regions for tests / debugging (plain numbers). */
export function serializeRegions(regions: SupportRegions): {
	edgeLines: Array<{ a: number[]; b: number[]; n: number[] }>;
	legendPoints: Array<{ p: number[]; n: number[] }>;
} {
	const v = (p: Vector3) => [p.x, p.y, p.z];
	return {
		edgeLines: regions.edgeLines.map((l) => ({
			a: v(l.points[0]),
			b: v(l.points[1]),
			n: v(l.normal)
		})),
		legendPoints: regions.legendPoints.map((p) => ({ p: v(p.point), n: v(p.normal) }))
	};
}
