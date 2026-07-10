import { describe, it, expect } from 'vitest';
import { manifold } from './manifold';

describe('manifold CSG immutability', () => {
	it('difference leaves operands alive and unchanged by triangle count', () => {
		const wasm = manifold();
		const a = wasm.Manifold.cube([10, 10, 10], true);
		const b = wasm.Manifold.cube([4, 4, 4], true).translate([2, 2, 2]);
		const aTrisBefore = a.getMesh().triVerts.length / 3;
		const bTrisBefore = b.getMesh().triVerts.length / 3;
		const c = wasm.Manifold.difference(a, b);
		const aTrisAfter = a.getMesh().triVerts.length / 3;
		const bTrisAfter = b.getMesh().triVerts.length / 3;
		expect(aTrisAfter).toBe(aTrisBefore);
		expect(bTrisAfter).toBe(bTrisBefore);
		expect(c.volume()).toBeLessThan(a.volume());
		c.delete();
		a.delete();
		b.delete();
	});

	it('instance subtract returns new manifold without deleting operands', () => {
		const wasm = manifold();
		const a = wasm.Manifold.cube([10, 10, 10], true);
		const b = wasm.Manifold.cube([4, 4, 4], true).translate([2, 2, 2]);
		const c = a.subtract(b);
		// operands still usable after subtract
		expect(a.volume()).toBeGreaterThan(0);
		expect(b.volume()).toBeGreaterThan(0);
		expect(c.volume()).toBeLessThan(a.volume());
		c.delete();
		a.delete();
		b.delete();
	});
});
