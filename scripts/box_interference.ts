// Diagnostic: fold the lid into its closed position and measure how much it
// intersects the base. A correct clamshell only touches at the seam plane, so
// the intersection volume should be ~0 (a little float noise from coincident
// faces is fine). A large value means a feature - e.g. the coin's support wedge
// poking above the seam - isn't being cleared by the opposing half.
//
// Run with:  bun run vite-node scripts/box_interference.ts

import dice from '../src/lib/dice/index';
import type { Dice, DiceSet, BoxConfig } from '../src/lib/interfaces/storage.svelte';
import { buildBox } from '../src/lib/box/box_builder';
import { defaultBoxParams } from '../src/lib/box/types';
import { getManifold, manifold, geometryToManifold } from '../src/lib/utils/manifold';

function makeSet(kinds: Array<keyof typeof dice>): DiceSet {
	const makeDie = (kind: keyof typeof dice): Dice => {
		const model = dice[kind];
		const parameters: Record<string, number> = {};
		for (const p of model.parameters) {
			parameters[p.id] = p.defaultValue;
		}
		return { id: kind, kind, parameters, face_parameters: [] };
	};
	return {
		id: 'test',
		name: 'test',
		updated: 0,
		dice: kinds.map(makeDie),
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

async function report(label: string, kinds: Array<keyof typeof dice>, trayDepth: number) {
	const set = makeSet(kinds);
	const built = await buildBox(set, makeConfig(set, { trayDepth }));
	const wasm = manifold();
	const seam = built.baseHeight;

	const base = geometryToManifold(built.base);
	const lid = geometryToManifold(built.lid);
	// fold the printed lid into its closed pose over the base: (x,y,z) ->
	// (x, -y, 2*seam - z), i.e. 180deg about X then lift by 2*seam.
	const closedLid = lid.rotate([180, 0, 0]).translate([0, 0, 2 * seam]);
	const overlap = wasm.Manifold.intersection(base, closedLid);

	const vBase = base.volume();
	const vOverlap = overlap.volume();
	base.delete();
	lid.delete();
	closedLid.delete();
	overlap.delete();

	const pct = ((vOverlap / vBase) * 100).toFixed(3);
	console.log(
		`${label.padEnd(28)} seam=${seam.toFixed(2)}mm  base=${vBase.toFixed(0)}mm^3  ` +
			`overlap=${vOverlap.toFixed(2)}mm^3 (${pct}% of base)`
	);
}

await getManifold();
console.log('Closed-box base/lid interference (lower is better; ~0 = clean clamshell):\n');
await report('cube (baseline noise)', ['d6_cube'], 1);
await report('coin, no tray', ['d2_coin'], 0);
await report('coin, tray depth 1', ['d2_coin'], 1);
await report('coin, tray depth 2', ['d2_coin'], 2);
