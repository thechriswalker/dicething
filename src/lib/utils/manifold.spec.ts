import { describe, it, expect, beforeAll } from 'vitest';
import { BoxGeometry } from 'three';
import {
	getManifold,
	geometryToManifold,
	manifold,
	manifoldToGeometry,
	differenceGeometry,
	toFlatPositions
} from './manifold';
import { checkMesh } from './mesh_check';

describe('manifold adapter', () => {
	beforeAll(async () => {
		await getManifold();
	});

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
});
