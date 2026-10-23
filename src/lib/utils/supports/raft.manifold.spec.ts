import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { checkIndexedMesh } from '../mesh_check';
import { manifoldToIndexedMesh, wasm, type Manifold } from '../manifold';
import { buildSingleSupportManifold } from './geometry';
import { buildSupportRaft, raftHoleCenter, type RaftFoot } from './raft';
import { DEFAULT_SUPPORT_SETTINGS } from './types';

function volumeAt(man: Manifold, x: number, y: number, z: number, size = 0.15): number {
	const probe = wasm.Manifold.cube([size, size, size], true).translate([x, y, z]);
	const hit = wasm.Manifold.intersection(man, probe);
	const volume = hit.volume();
	hit.delete();
	probe.delete();
	return volume;
}

describe('support raft', () => {
	it('hulls the pillars and slopes the rim out toward the top', () => {
		const depth = 1;
		const margin = 1.5;
		const radius = 0.4;
		const raft = buildSupportRaft(
			[
				{ x: 0, z: 0, radius },
				{ x: 16, z: 0, radius }
			],
			depth,
			margin
		);
		expect(raft).toBeDefined();
		// Midway between the pillars, in the drafted rim: above the inset base, below the wider top.
		const side = radius + margin - 0.35;
		try {
			expect(volumeAt(raft!, 8, depth - 0.15, side)).toBeGreaterThan(0);
			expect(volumeAt(raft!, 8, 0.08, side)).toBe(0);
			const { positions, indices } = manifoldToIndexedMesh(raft!);
			const report = checkIndexedMesh(positions, indices);
			expect(report.isWatertight).toBe(true);
			expect(report.isManifold).toBe(true);
		} finally {
			raft!.delete();
		}
	});

	it('drills hexagonal vents and leaves the web between them', () => {
		const feet: Array<RaftFoot> = [];
		for (const x of [-12, 12]) {
			for (const z of [-10, 10]) {
				feet.push({ x, z, radius: 0.4 });
			}
		}
		const raft = buildSupportRaft(feet, 1, 1.5);
		expect(raft).toBeDefined();
		const neighbor = raftHoleCenter(1, 0);
		const web = { x: neighbor.x / 2, z: neighbor.z / 2 };
		try {
			expect(volumeAt(raft!, 0, 0.5, 0)).toBe(0);
			expect(volumeAt(raft!, web.x, 0.5, web.z)).toBeGreaterThan(0);
			// Same footprint at the top and the bottom: the vent is a vertical prism.
			expect(volumeAt(raft!, 0, 0.15, 1)).toBe(0);
			expect(volumeAt(raft!, 0, 0.85, 1)).toBe(0);
		} finally {
			raft!.delete();
		}
	});

	it('partially fills the vent around a pillar that sits inside it', () => {
		const raft = buildSupportRaft([{ x: 0, z: 0, radius: 0.4 }], 1, 3);
		expect(raft).toBeDefined();
		// The lattice tie breaks toward the 30° flat. Cross-section Y is world -Z.
		const angle = Math.PI / 6;
		const reach = 0.85;
		const toward = { x: reach * Math.cos(angle), z: -reach * Math.sin(angle) };
		const away = { x: -toward.x, z: -toward.z };
		try {
			expect(volumeAt(raft!, toward.x, 0.5, toward.z)).toBeGreaterThan(0);
			expect(volumeAt(raft!, away.x, 0.5, away.z)).toBe(0);
		} finally {
			raft!.delete();
		}
	});

	it('anchors a pillar that only just misses the vent wall', () => {
		// Apothem is 1.25mm. Sitting 0.77mm off centre leaves a 0.08mm gap, which
		// used to be treated as already touching.
		const radius = 0.4;
		const shift = 1.25 - (radius + 0.08);
		const angle = Math.PI / 6;
		const foot = { x: shift * Math.cos(angle), z: -shift * Math.sin(angle), radius };
		const raft = buildSupportRaft([foot], 1, 3);
		expect(raft).toBeDefined();
		// In the sliver between the pillar surface (0.77 + 0.4) and the wall (1.25).
		const further = 1.2;
		const probe = { x: further * Math.cos(angle), z: -further * Math.sin(angle) };
		try {
			expect(volumeAt(raft!, probe.x, 0.5, probe.z, 0.06)).toBeGreaterThan(0);
		} finally {
			raft!.delete();
		}
	});

	it('fills the gap between pillars that sit tight together', () => {
		const feet: Array<RaftFoot> = [];
		for (const x of [-12, 12]) {
			for (const z of [-10, 10]) {
				feet.push({ x, z, radius: 0.4 });
			}
		}
		feet.push({ x: -0.6, z: 0, radius: 0.35 }, { x: 0.6, z: 0, radius: 0.35 });
		const raft = buildSupportRaft(feet, 1, 1.5);
		expect(raft).toBeDefined();
		try {
			expect(volumeAt(raft!, 0, 0.5, 0)).toBeGreaterThan(0);
			expect(volumeAt(raft!, 0, 0.5, 1)).toBe(0);
		} finally {
			raft!.delete();
		}
	});

	it('leaves the vents open inside a ring of close pillars', () => {
		const radius = 0.4;
		const ring = 14;
		const count = Math.round((2 * Math.PI * ring) / 1);
		const feet: Array<RaftFoot> = [];
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2;
			feet.push({ x: ring * Math.cos(angle), z: ring * Math.sin(angle), radius });
		}
		const raft = buildSupportRaft(feet, 1, 1.5);
		expect(raft).toBeDefined();
		const inner = raftHoleCenter(2, -1);
		try {
			expect(Math.hypot(inner.x, inner.z)).toBeLessThan(ring - 3);
			expect(volumeAt(raft!, 0, 0.5, 0)).toBe(0);
			expect(volumeAt(raft!, inner.x, 0.5, inner.z)).toBe(0);
		} finally {
			raft!.delete();
		}
	});

	it('runs the pillar down to the build plate', () => {
		const foot = { contact: new Vector3(4, 14, 0), footX: 1.2, footZ: -0.4, coneBaseY: 8 };
		const man = buildSingleSupportManifold(foot, DEFAULT_SUPPORT_SETTINGS);
		try {
			expect(volumeAt(man, foot.footX, 0.08, foot.footZ, 0.2)).toBeGreaterThan(0);
			expect(volumeAt(man, foot.footX + 3, 0.08, foot.footZ, 0.2)).toBe(0);
		} finally {
			man.delete();
		}
	});
});
