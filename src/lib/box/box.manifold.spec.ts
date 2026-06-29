import { describe, it, expect, beforeAll } from 'vitest';
import { Vector2, type BufferGeometry } from 'three';
import dice from '$lib/dice';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import { getManifold, manifold, geometryToManifold, toFlatPositions } from '$lib/utils/manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import { buildBox, chooseHingeClusters, magnetCorners, prepareLayout } from './box_builder';
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
			x: 0,
			y: 0,
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
		expect(built.hinge).toBeTruthy();
	});

	it('chooses 1 hinge cluster when narrow, 2 when wide', () => {
		// flat back-edge length = 2*(outerHalf.x - bodyChamfer). 5 knuckles ->
		// targetLen = 20mm, so two need >= 52mm of flat edge.
		const knuckles = 5;
		expect(chooseHingeClusters(new Vector2(18, 14), 8, knuckles).length).toBe(1);
		const two = chooseHingeClusters(new Vector2(50, 14), 8, knuckles);
		expect(two.length).toBe(2);
		// the two clusters are symmetric about the centre and stay on the flat run.
		expect(two[0].centerX).toBeCloseTo(-two[1].centerX, 6);
		const flatHalf = 50 - 8;
		for (const c of two) {
			expect(Math.abs(c.centerX) + c.length / 2).toBeLessThanOrEqual(flatHalf + 1e-6);
		}
	});

	it('builds a real hinge into both halves (1 and 2 clusters) and stays printable', async () => {
		// a single small die -> a narrow box (one cluster); a row of cubes -> a
		// wide box (two clusters). Both must produce watertight, manifold halves.
		for (const set of [
			makeSet(['d6_cube']),
			makeSet(['d6_cube', 'd6_cube', 'd6_cube', 'd6_cube'])
		]) {
			const config = makeConfig(set, { rows: 1 });
			config.params.hinge.enabled = true;
			const built = await buildBox(set, config);
			expectPrintable(built.base);
			expectPrintable(built.lid);
			expect(built.hinge).toBeTruthy();
		}
	});

	it('raises a round knuckle bump above the seam and braces it to the wall', async () => {
		// the round barrel bump must rise ABOVE the seam (an upward feature, not a
		// downward overhang); its self-supporting tail leans back into the body so
		// the elevated barrel has no unsupported overhang, and the half still sits
		// flat on the bed (z = 0) via the body.
		const set = makeSet(['d6_cube', 'd6_cube']);

		const config = makeConfig(set, { rows: 1 });
		config.params.hinge.enabled = true;
		const built = await buildBox(set, config);
		built.base.computeBoundingBox();
		const seam = built.hinge!.axisZ;
		expect(built.base.boundingBox!.min.z).toBeCloseTo(0, 5);
		expect(built.base.boundingBox!.max.z).toBeGreaterThan(seam + 1);
	});

	it('lays out the hinged halves interlocked without fusing them', async () => {
		// the print-in-place layout places the halves a parting gap apart so their
		// barrels are coaxial. With the clearances built in, the two solids must
		// barely touch - any real overlap would fuse the joint.
		const set = makeSet(['d6_cube', 'd6_cube', 'd6_cube']);
		const config = makeConfig(set, { rows: 1 });
		config.params.hinge.enabled = true;
		const built = await buildBox(set, config);
		const halfOffset = built.outer.y / 2 + built.hinge!.partingGap / 2;
		const base = built.base.clone();
		base.translate(0, -halfOffset, 0);
		const lid = built.lid.clone();
		lid.translate(0, halfOffset, 0);
		const wasm = manifold();
		const mb = geometryToManifold(base);
		const ml = geometryToManifold(lid);
		const inter = wasm.Manifold.intersection(mb, ml);
		const overlap = inter.volume();
		const baseVol = mb.volume();
		inter.delete();
		mb.delete();
		ml.delete();
		// overlap should be a vanishing fraction of a half's volume (clearance only).
		expect(overlap).toBeLessThan(baseVol * 0.01);
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

	it('builds the coin support as a positive, outward-wound solid', async () => {
		// regression: a clockwise boundary makes the wedge emit inside-out
		// triangles, which Manifold reads as a negative-volume solid that won't
		// union into the base. The support must be a genuine positive solid.
		const model = dice['d2_coin'];
		expect(model.boxSupport).toBeTruthy();
		const params: Record<string, number> = {};
		for (const p of model.parameters) {
			params[p.id] = p.defaultValue;
		}
		const geo = model.boxSupport!(params, {}, { seam: 8, floor: 1.2, cavityTolerance: 0.4 });
		expect(geo).toBeTruthy();
		const man = geometryToManifold(geo!);
		const volume = man.volume();
		man.delete();
		expect(volume).toBeGreaterThan(0);
		expectPrintable(geo!);
	});

	it('builds the coin support for a concave custom outline', async () => {
		// the support footprint is the coin's real face outline, which for a custom
		// path may be CONCAVE. The wedge must still tessellate to a positive,
		// watertight, degenerate-free solid (libtess caps + centroid-scaled
		// rounding), not a fan-triangulated mess.
		const model = dice['d2_coin'];
		const params: Record<string, number> = {};
		for (const p of model.parameters) {
			params[p.id] = p.defaultValue;
		}
		params.coin_shape_mode = 1; // custom path
		// a concave star-ish outline (notches between the points).
		const coin_path =
			'M 50 0 L 61 35 L 98 35 L 68 57 L 79 91 L 50 70 L 21 91 L 32 57 L 2 35 L 39 35 Z';
		const geo = model.boxSupport!(
			params,
			{ coin_path },
			{ seam: 8, floor: 1.2, cavityTolerance: 0.4 }
		);
		expect(geo).toBeTruthy();
		const man = geometryToManifold(geo!);
		const volume = man.volume();
		man.delete();
		expect(volume).toBeGreaterThan(0);
		expectPrintable(geo!);
	});

	it('props the tilted coin with a ramp wedge and still closes', async () => {
		// the coin rests tilted (boxTransform) and gets a support wedge
		// (boxSupport) whose top follows its underside. The wedge rises above the
		// seam, so the builder also folds a clearance pocket into the lid; both
		// halves must stay closed/manifold. Use a tray recess so the coin sits over
		// a depression (the case the prop is for).
		const set = makeSet(['d2_coin']);
		const config = makeConfig(set, { trayDepth: 1 });
		const built = await buildBox(set, config);
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

	it('packs mixed dice tighter than a uniform grid', async () => {
		// one large die beside several small ones. A uniform grid would size every
		// cell to the large die and waste the space around the small dice; per-die
		// packing should give a much smaller footprint.
		const mixed = makeSet(['d20_icosahedron', 'd6_cube', 'd6_cube', 'd6_cube']);
		const built = await buildBox(mixed, makeConfig(mixed, { rows: 2 }));
		expectPrintable(built.base);
		expectPrintable(built.lid);

		// baseline: a single large die's box footprint ~ one uniform grid cell.
		const bigSet = makeSet(['d20_icosahedron']);
		const big = await buildBox(bigSet, makeConfig(bigSet));
		const cellArea = big.outer.x * big.outer.y;
		// four uniform cells would be ~4x the cell area; packing must beat that.
		expect(built.outer.x * built.outer.y).toBeLessThan(cellArea * 4);
	});

	it('keeps every die inside the box footprint', async () => {
		const set = makeSet(['d4_caltrop', 'd6_cube', 'd8_trapezohedron', 'd20_icosahedron']);
		const built = await buildBox(set, makeConfig(set, { rows: 2 }));
		const outerHalf = new Vector2(built.outer.x / 2, built.outer.y / 2);
		for (const d of built.placedDice) {
			d.geometry.computeBoundingBox();
			const bb = d.geometry.boundingBox!;
			expect(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x))).toBeLessThanOrEqual(outerHalf.x);
			expect(Math.max(Math.abs(bb.min.y), Math.abs(bb.max.y))).toBeLessThanOrEqual(outerHalf.y);
		}
	});

	it('builds from manual placements + an explicit box size', async () => {
		// the 2D layout editor stores per-die x/y/rotation and an explicit box; the
		// build must honour them (no auto-layout) and stay printable.
		const set = makeSet(['d6_cube', 'd6_cube', 'd20_icosahedron']);
		const config = makeConfig(set);
		const prep = await prepareLayout(set, config);
		config.params.manual = true;
		config.params.box = { halfX: prep.box.halfX, halfY: prep.box.halfY };
		for (const pl of config.placements) {
			const d = prep.dice.find((x) => x.dieId === pl.dieId)!;
			pl.x = d.autoPos.x;
			pl.y = d.autoPos.y;
			pl.rotation = 0;
		}
		const built = await buildBox(set, config);
		expectPrintable(built.base);
		expectPrintable(built.lid);
		// the footprint comes straight from the explicit box, not the auto sizing.
		expect(built.outer.x).toBeCloseTo(prep.box.halfX * 2, 6);
		expect(built.outer.y).toBeCloseTo(prep.box.halfY * 2, 6);
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
