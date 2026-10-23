import { describe, it, expect } from 'vitest';
import { BoxGeometry } from 'three';
import {
	geometryToManifold,
	manifold,
	manifoldToGeometry,
	manifoldToIndexedMesh,
	differenceGeometry,
	mapOwned,
	toFlatPositions
} from './manifold';
import { checkMesh } from './mesh_check';
import { manifoldToFlatPositions } from './export';

describe('manifold adapter', () => {
	it('round-trips a three geometry through Manifold and stays watertight', () => {
		const box = new BoxGeometry(10, 10, 10);
		const man = geometryToManifold(box);
		expect(man.status()).toBe('NoError');
		const geo = manifoldToGeometry(man);
		man.delete();
		const report = checkMesh(toFlatPositions(geo));
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.degenerateTriangleCount).toBe(0);
	});

	it('manifoldToIndexedMesh copies mesh without a three round-trip', () => {
		const man = geometryToManifold(new BoxGeometry(10, 10, 10));
		const indexed = manifoldToIndexedMesh(man);
		man.delete();
		expect(indexed.positions.length).toBeGreaterThan(0);
		expect(indexed.indices.length).toBeGreaterThan(0);
		expect(indexed.positions.length % 3).toBe(0);
		expect(indexed.indices.length % 3).toBe(0);
	});

	it('manifoldToFlatPositions stays printable', () => {
		const man = geometryToManifold(new BoxGeometry(10, 10, 10));
		const report = checkMesh(manifoldToFlatPositions(man, 'y'));
		man.delete();
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.isPrintable).toBe(true);
	});

	it('cuts a cylinder out of a box and the result is a printable solid', () => {
		const wasm = manifold();
		const base = geometryToManifold(new BoxGeometry(20, 8, 20));
		// a vertical bore through the slab (manifold cylinder is along +Z, so the
		// box being centred on the origin and the cylinder centred + tall enough to
		// punch right through gives a clean through-hole).
		const bore = wasm.Manifold.cylinder(40, 3, 3, 48, true).rotate([90, 0, 0]);
		const geo = differenceGeometry(base, [bore]);
		const report = checkMesh(toFlatPositions(geo));
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.degenerateTriangleCount).toBe(0);
		expect(report.duplicateTriangleCount).toBe(0);
		// a through-hole adds genus, so it must have more triangles than the slab.
		expect(report.triangleCount).toBeGreaterThan(12);
	});

	it('mapOwned deletes every transform except the last', () => {
		const wasm = manifold();
		const probe = wasm.Manifold.cube([1, 1, 1], true);
		const proto = Object.getPrototypeOf(probe) as { delete: () => void };
		probe.delete();
		const orig = proto.delete;
		let deleted = 0;
		proto.delete = function (this: unknown) {
			deleted += 1;
			return orig.call(this);
		};
		try {
			const out = mapOwned(
				wasm.Manifold.cube([1, 1, 1], true),
				(m) => m.translate([2, 0, 0]),
				(m) => m.rotate([0, 90, 0])
			);
			// cube + translated copy. The rotated result stays alive.
			expect(deleted).toBe(2);
			expect(out.volume()).toBeCloseTo(1);
			out.delete();
			expect(deleted).toBe(3);
		} finally {
			proto.delete = orig;
		}
	});
});
