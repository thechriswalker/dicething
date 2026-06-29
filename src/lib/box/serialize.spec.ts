import { describe, it, expect, beforeAll } from 'vitest';
import type { BufferGeometry } from 'three';
import dice from '$lib/dice';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import { getManifold, toFlatPositions } from '$lib/utils/manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import { buildBox, prepareLayout, type BuildProgress } from './box_builder';
import {
	serializeBuiltBox,
	rehydrateBuiltBox,
	serializePreparedLayout,
	rehydratePreparedLayout,
	builtBoxTransferables
} from './serialize';
import { defaultBoxParams, type BoxConfig } from './types';

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
		legends: {} as DiceSet['legends']
	};
}

function makeConfig(set: DiceSet): BoxConfig {
	return {
		setId: set.id,
		updated: 0,
		params: defaultBoxParams(),
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

describe('box serialisation round-trip', () => {
	beforeAll(async () => {
		await getManifold();
	});

	it('rehydrates a built box that is still watertight + manifold', async () => {
		const set = makeSet(['d6_cube', 'd20_icosahedron', 'd10_trapezohedron']);
		const built = await buildBox(set, makeConfig(set));

		const serial = serializeBuiltBox(built);
		const back = rehydrateBuiltBox(serial);

		expectPrintable(back.base);
		expectPrintable(back.lid);

		// positions survive verbatim (same triangle count).
		expect(back.base.getAttribute('position').count).toBe(
			built.base.getAttribute('position').count
		);
		expect(back.lid.getAttribute('position').count).toBe(built.lid.getAttribute('position').count);

		// scalars + vectors come back unchanged.
		expect(back.baseHeight).toBe(built.baseHeight);
		expect(back.lidHeight).toBe(built.lidHeight);
		expect(back.outer.x).toBeCloseTo(built.outer.x, 6);
		expect(back.outer.y).toBeCloseTo(built.outer.y, 6);

		// placed dice + boundaries preserved.
		expect(back.placedDice.length).toBe(built.placedDice.length);
		expect(back.boundaries.dice.length).toBe(built.boundaries.dice.length);
		expect(back.boundaries.inner.length).toBe(built.boundaries.inner.length);
		expect(back.boundaries.combined.length).toBe(built.boundaries.combined.length);
	});

	it('collects a transferable buffer for every geometry', async () => {
		const set = makeSet(['d6_cube', 'd6_cube']);
		const built = await buildBox(set, makeConfig(set));
		const serial = serializeBuiltBox(built);
		const transfers = builtBoxTransferables(serial);
		// base + lid + every placed die, each contributing at least its position
		// buffer (indexed geometry adds another, so >= this count).
		expect(transfers.length).toBeGreaterThanOrEqual(2 + serial.placedDice.length);
		for (const t of transfers) {
			expect(t).toBeInstanceOf(ArrayBuffer);
		}
	});

	it('round-trips a prepared layout', async () => {
		const set = makeSet(['d6_cube', 'd8_trapezohedron', 'd12_dodecahedron']);
		const layout = await prepareLayout(set, makeConfig(set));
		const back = rehydratePreparedLayout(serializePreparedLayout(layout));

		expect(back.dice.length).toBe(layout.dice.length);
		expect(back.box.halfX).toBeCloseTo(layout.box.halfX, 6);
		expect(back.box.halfY).toBeCloseTo(layout.box.halfY, 6);
		for (let i = 0; i < layout.dice.length; i++) {
			expect(back.dice[i].dieId).toBe(layout.dice[i].dieId);
			expect(back.dice[i].kind).toBe(layout.dice[i].kind);
			expect(back.dice[i].hull0.length).toBe(layout.dice[i].hull0.length);
			expect(back.dice[i].size.z).toBeCloseTo(layout.dice[i].size.z, 6);
		}
	});
});

describe('box build progress reporting', () => {
	beforeAll(async () => {
		await getManifold();
	});

	it('emits ordered steps from 0 to totalSteps (= dice + 2)', async () => {
		const set = makeSet(['d6_cube', 'd20_icosahedron']);
		const ticks: Array<BuildProgress> = [];
		await buildBox(set, makeConfig(set), (p) => ticks.push(p));

		expect(ticks.length).toBeGreaterThan(0);
		const total = set.dice.length + 2;
		for (const t of ticks) {
			expect(t.totalSteps).toBe(total);
		}
		expect(ticks[0].step).toBe(0);
		expect(ticks.at(-1)!.step).toBe(total);
		// monotonically non-decreasing.
		for (let i = 1; i < ticks.length; i++) {
			expect(ticks[i].step).toBeGreaterThanOrEqual(ticks[i - 1].step);
		}
		// the two final phases are the base then lid cuts.
		expect(ticks.some((t) => t.phase === 'base')).toBe(true);
		expect(ticks.at(-1)!.phase).toBe('lid');
	});
});
