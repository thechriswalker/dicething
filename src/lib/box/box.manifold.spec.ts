import { describe, it, expect, beforeAll } from 'vitest';
import { Vector2, type BufferGeometry } from 'three';
import dice from '$lib/dice';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import { getManifold, manifold, geometryToManifold, toFlatPositions } from '$lib/utils/manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import { buildBox, magnetCorners, recessChamfer } from './box_builder';
import { defaultBoxParams, type BoxConfig } from './types';

// build a Dice using a model's parameter defaults (no legends needed: the box
// builder only uses the blank face geometry).
function makeDie(kind: keyof typeof dice): Dice {
	const model = dice[kind];
	const parameters: Record<string, number> = {};
	for (const p of model.parameters) {
		parameters[p.id] = p.defaultValue;
	}
	return { id: kind, kind, parameters, face_parameters: [] };
}

function makeSet(kinds: Array<keyof typeof dice>): DiceSet {
	return {
		id: 'test',
		name: 'test',
		updated: 0,
		dice: kinds.map(makeDie),
		// the box builder never reads legends.
		legends: {} as DiceSet['legends']
	};
}

function makeConfig(set: DiceSet, overrides: Partial<BoxConfig['params']> = {}): BoxConfig {
	return {
		setId: set.id,
		updated: 0,
		params: { ...defaultBoxParams(), ...overrides },
		placements: set.dice.map((d, i) => ({
			dieId: d.id,
			order: i,
			rotation: 0,
			include: true
		}))
	};
}

function expectPrintable(geo: BufferGeometry) {
	const report = checkMesh(toFlatPositions(geo));
	expect(report.isWatertight).toBe(true);
	expect(report.isManifold).toBe(true);
	expect(report.degenerateTriangleCount).toBe(0);
	expect(report.duplicateTriangleCount).toBe(0);
}

describe('box builder produces printable solids', () => {
	beforeAll(async () => {
		await getManifold();
	});

	it('builds a watertight base + lid for a mixed set', async () => {
		const set = makeSet(['d6_cube', 'd20_icosahedron', 'd10_trapezohedron', 'd6_crystal']);
		const built = await buildBox(set, makeConfig(set));
		expectPrintable(built.base);
		expectPrintable(built.lid);
	});

	it('builds equal-height clamshell halves', async () => {
		const set = makeSet(['d6_cube', 'd8_trapezohedron', 'd4_caltrop', 'd12_dodecahedron']);
		const built = await buildBox(set, makeConfig(set));
		expect(built.baseHeight).toBeCloseTo(built.lidHeight, 6);
		expectPrintable(built.base);
		expectPrintable(built.lid);
	});

	it('stays printable with a hinge (two magnets)', async () => {
		const set = makeSet(['d6_cube', 'd20_icosahedron']);
		const config = makeConfig(set);
		config.params.hinge.enabled = true;
		const built = await buildBox(set, config);
		expectPrintable(built.base);
		expectPrintable(built.lid);
	});

	it('cuts magnet bores and stays printable', async () => {
		const set = makeSet(['d6_cube', 'd6_cube']);
		const config = makeConfig(set);
		config.params.magnets.enabled = true;
		const built = await buildBox(set, config);
		expectPrintable(built.base);
		expectPrintable(built.lid);
	});

	it('places two magnets on the opening side, away from the hinge', () => {
		const outerHalf = new Vector2(30, 24);
		const two = magnetCorners(outerHalf, 12, 3.15, 2.4, 2);
		expect(two.length).toBe(2);
		// the hinge runs along +y, so the pair sits on the -y (opening) side.
		for (const c of two) {
			expect(c.y).toBeLessThan(0);
		}
		expect(magnetCorners(outerHalf, 12, 3.15, 2.4, 4).length).toBe(4);
		expect(magnetCorners(outerHalf, 12, 3.15, 2.4, 0).length).toBe(0);
	});

	it('cuts two magnet bores (opening side) and stays printable', async () => {
		const set = makeSet(['d6_cube', 'd6_cube', 'd6_cube', 'd6_cube']);
		const config = makeConfig(set, { rows: 2 });
		config.params.magnets.enabled = true;
		config.params.magnets.count = 2;
		const built = await buildBox(set, config);
		expectPrintable(built.base);
		expectPrintable(built.lid);
	});

	it('handles a barrel (round-walled) die', async () => {
		const set = makeSet(['d6_barrel']);
		const built = await buildBox(set, makeConfig(set));
		expectPrintable(built.base);
		expectPrintable(built.lid);
	});

	// The cavities must be "press-in" shaped: a die pushed into the half must be
	// removable straight up, so the cavity may never lean back inward over its
	// opening. We verify it by slicing the finished half: as you go UP through the
	// cavity depth the remaining solid may only shrink (the cavity only widens),
	// i.e. each higher slice is contained in the one below it. An undercut would
	// leave solid sticking out over the hole and show up as area in
	// upper-minus-lower.
	function expectDraftFree(geo: BufferGeometry, seam: number, floor: number, bevel: number) {
		const wasm = manifold();
		const man = geometryToManifold(geo);
		const N = 24;
		// start above the outer bevel: that chamfer is an intentional 45-degree
		// truncation of the bottom edge (a printable overhang). Above it the outer
		// profile is constant, so only the die cavity moves the cross-section.
		const z0 = Math.max(floor, bevel) + 0.5;
		const z1 = seam - 0.3;
		let lower = man.slice(z0);
		let maxOverhang = 0;
		for (let i = 1; i <= N; i++) {
			const z = z0 + ((z1 - z0) * i) / N;
			const upper = man.slice(z);
			// solid present higher up but not lower down => an inward-leaning wall.
			const overhang = wasm.CrossSection.difference(upper, lower);
			maxOverhang = Math.max(maxOverhang, overhang.area());
			overhang.delete();
			lower.delete();
			lower = upper;
		}
		lower.delete();
		man.delete();
		// allow a hair for slicing/round-off; real undercuts are many mm^2.
		expect(maxOverhang).toBeLessThan(0.05);
	}

	it('mirrors the lid layout so it meshes with the base when closed', async () => {
		// the lid folds over (180deg about the X/hinge edge) to close, which
		// negates Y. So each lid die must sit at the base die's (x, -y) for the
		// halves to mate. Use a multi-row set so the positions have non-zero Y.
		const set = makeSet(['d6_cube', 'd8_trapezohedron', 'd10_trapezohedron', 'd12_dodecahedron']);
		const built = await buildBox(set, makeConfig(set, { rows: 2 }));
		const centreXY = (geo: BufferGeometry) => {
			geo.computeBoundingBox();
			const bb = geo.boundingBox!;
			return { x: (bb.min.x + bb.max.x) / 2, y: (bb.min.y + bb.max.y) / 2 };
		};
		const bases = new Map(
			built.placedDice.filter((d) => d.half === 'base').map((d) => [d.dieId, centreXY(d.geometry)])
		);
		const lids = built.placedDice.filter((d) => d.half === 'lid');
		expect(lids.length).toBeGreaterThan(0);
		let sawOffset = false;
		for (const lid of lids) {
			const base = bases.get(lid.dieId)!;
			const lc = centreXY(lid.geometry);
			expect(lc.x).toBeCloseTo(base.x, 3);
			// closing fold negates Y: lid.y should equal -base.y.
			expect(lc.y).toBeCloseTo(-base.y, 3);
			if (Math.abs(base.y) > 0.5) sawOffset = true;
		}
		expect(sawOffset).toBe(true);
	});

	it('grows the footprint so every die stays inside the recessed octagon', async () => {
		// a block of dice forces some into the corners, which used to overlap the
		// (deeply chamfered) corner truncations of the interior recess.
		const set = makeSet(['d6_cube', 'd6_cube', 'd6_cube', 'd6_cube', 'd6_cube', 'd6_cube']);
		const config = makeConfig(set, { rows: 2 });
		const p = config.params;
		const built = await buildBox(set, config);

		// the body octagon is the widest footprint, so outerHalf = outer / 2.
		const outerHalf = new Vector2(built.outer.x / 2, built.outer.y / 2);
		const magRadius = p.magnets.diameter / 2 + p.magnets.tolerance;
		const corners = magnetCorners(outerHalf, p.chamfer, magRadius, p.wall, p.magnets.count);
		const recessC = recessChamfer(outerHalf, p.chamfer, p.wall, corners, magRadius + 1.0);
		const innerX = outerHalf.x - p.wall;
		const innerY = outerHalf.y - p.wall;
		const diag = innerX + innerY - recessC;
		expect(built.placedDice.length).toBe(set.dice.length * 2);
		for (const d of built.placedDice) {
			d.geometry.computeBoundingBox();
			const bb = d.geometry.boundingBox!;
			for (const x of [bb.min.x, bb.max.x]) {
				for (const y of [bb.min.y, bb.max.y]) {
					expect(Math.abs(x)).toBeLessThanOrEqual(innerX + 1e-6);
					expect(Math.abs(y)).toBeLessThanOrEqual(innerY + 1e-6);
					// the chamfered (diagonal) recess edge must clear every die corner.
					expect(Math.abs(x) + Math.abs(y)).toBeLessThanOrEqual(diag + 1e-6);
				}
			}
		}
	});

	it('cuts draft-free cavities (a pushed-in die can be lifted out)', async () => {
		// a tetrahedron is the worst case: an exact cavity traps it.
		for (const kind of ['d4_caltrop', 'd8_trapezohedron', 'd20_icosahedron'] as const) {
			const set = makeSet([kind]);
			// disable magnets so the slice test sees only the die cavity.
			const config = makeConfig(set);
			config.params.magnets.enabled = false;
			const built = await buildBox(set, config);
			expectDraftFree(built.base, built.baseHeight, config.params.floor, config.params.bevel);
			expectDraftFree(built.lid, built.lidHeight, config.params.floor, config.params.bevel);
		}
	});
});
