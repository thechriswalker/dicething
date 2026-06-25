// Offline generator for src/lib/dice/numbering_orders.ts.
//
// Works out a balanced numbering order for each convex-polyhedron (isohedral)
// die and writes it out as static data, so the runtime builder just reshuffles
// faces with no maths involved.
//
// Run with:  bunx vite-node scripts/generate_numbering.ts
//
// Tweak the algorithm here (or hand-edit the generated file) and re-run.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Vector3 } from 'three';
import dice from '../src/lib/dice/index';
import { numberingOrders, type NumberingOrder } from '../src/lib/dice/numbering_orders';

// the dice built by convexPolyhedronDie (those whose numbering we generate).
const CONVEX_POLYHEDRON_DICE = [
	'd6_skew',
	'd12_tetartoid',
	'd24_deltoidal_icositetrahedron',
	'd24_tetrakis_hexahedron',
	'd24_pentagonal_icositetrahedron',
	'd30_rhombic_triacontahedron',
	'd60_deltoidal_hexecontahedron',
	'd60_pentakis_dodecahedron',
	'd60_pentagonal_hexecontahedron'
];

// ---------------------------------------------------------------------------
// the balancing algorithm
// ---------------------------------------------------------------------------

// tiny deterministic PRNG, so generation is reproducible run to run.
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Returns an array whose k-th entry is the index of the face that should carry
// value (k+1).
//
// Two goals, the way good dice are numbered:
//   1. opposite faces hold complementary values that sum to n+1, and
//   2. high and low numbers are spread evenly over the solid (no clustering).
//
// We pair each face with its (near-)antipodal face - for the centrally
// symmetric solids this is exact, for the chiral ones it is the closest to
// opposite - so every pair carries {v, n+1-v}. Then we choose which magnitude v
// each pair gets, and which way round it sits, by simulated annealing that
// minimises a Thomson-style energy: treat each face value as a charge
// q = value - mean and sum q_i*q_j / distance, so like charges (two highs or two
// lows) are pushed apart while highs and lows interleave. A deterministic greedy
// pass then settles it into a local minimum.
function balancedFaceOrder(directions: Array<Vector3>): Array<number> {
	const n = directions.length;
	if (n < 2) {
		return directions.map((_, i) => i);
	}
	const dirs = directions.map((d) => d.clone().normalize());

	// 1) greedy (near-)antipodal pairing.
	const used = new Array<boolean>(n).fill(false);
	const pairs: Array<[number, number]> = [];
	for (let i = 0; i < n; i++) {
		if (used[i]) {
			continue;
		}
		let best = -1;
		let bestDot = -Infinity;
		for (let j = i + 1; j < n; j++) {
			if (used[j]) {
				continue;
			}
			const d = -dirs[i].dot(dirs[j]);
			if (d > bestDot) {
				bestDot = d;
				best = j;
			}
		}
		if (best < 0) {
			used[i] = true;
			pairs.push([i, i]);
			continue;
		}
		used[i] = used[best] = true;
		pairs.push([i, best]);
	}
	const m = pairs.length;

	// 2) inverse chord-distance weights (the Thomson kernel).
	const inv: Array<Array<number>> = [];
	for (let i = 0; i < n; i++) {
		inv[i] = new Array<number>(n).fill(0);
		for (let j = 0; j < n; j++) {
			if (i !== j) {
				inv[i][j] = 1 / Math.max(dirs[i].distanceTo(dirs[j]), 1e-6);
			}
		}
	}

	const mean = (n + 1) / 2;
	const value = new Array<number>(n).fill(0);
	const q = new Array<number>(n).fill(0);
	const magnitude = pairs.map((_, p) => p + 1); // low value per pair (perm of 1..m)
	const orient = pairs.map(() => 0);

	const applyPair = (p: number) => {
		const [a, b] = pairs[p];
		const low = magnitude[p];
		const high = n + 1 - magnitude[p];
		value[a] = orient[p] === 0 ? low : high;
		value[b] = orient[p] === 0 ? high : low;
		q[a] = value[a] - mean;
		q[b] = value[b] - mean;
	};
	for (let p = 0; p < m; p++) {
		applyPair(p);
	}

	const partial = (faces: Array<number>): number => {
		let e = 0;
		const set = new Set(faces);
		for (const i of faces) {
			for (let j = 0; j < n; j++) {
				if (j !== i && !set.has(j)) {
					e += q[i] * q[j] * inv[i][j];
				}
			}
		}
		for (let a = 0; a < faces.length; a++) {
			for (let b = a + 1; b < faces.length; b++) {
				e += q[faces[a]] * q[faces[b]] * inv[faces[a]][faces[b]];
			}
		}
		return e;
	};

	const swap = (p1: number, p2: number) => {
		const t = magnitude[p1];
		magnitude[p1] = magnitude[p2];
		magnitude[p2] = t;
		applyPair(p1);
		applyPair(p2);
	};
	const flip = (p: number) => {
		orient[p] ^= 1;
		applyPair(p);
	};

	const rng = mulberry32(0x9e3779b1);

	let sample = 0;
	let count = 0;
	for (let s = 0; s < 200 && m > 1; s++) {
		const p1 = Math.floor(rng() * m);
		const p2 = Math.floor(rng() * m);
		if (p1 === p2) {
			continue;
		}
		const faces = [...pairs[p1], ...pairs[p2]];
		const before = partial(faces);
		swap(p1, p2);
		sample += Math.abs(partial(faces) - before);
		count++;
		swap(p1, p2);
	}
	let temp0 = count > 0 ? (2 * sample) / count : 1;
	if (!(temp0 > 0)) {
		temp0 = 1;
	}
	const tempEnd = temp0 * 1e-4;

	const iterations = Math.max(4000, 400 * n);
	for (let it = 0; it < iterations; it++) {
		const temp = temp0 * Math.pow(tempEnd / temp0, it / iterations);
		if (rng() < 0.5 && m > 1) {
			const p1 = Math.floor(rng() * m);
			const p2 = Math.floor(rng() * m);
			if (p1 === p2) {
				continue;
			}
			const faces = [...pairs[p1], ...pairs[p2]];
			const before = partial(faces);
			swap(p1, p2);
			const dE = partial(faces) - before;
			if (dE > 0 && rng() >= Math.exp(-dE / temp)) {
				swap(p1, p2);
			}
		} else {
			const p = Math.floor(rng() * m);
			const faces = pairs[p];
			const before = partial(faces);
			flip(p);
			const dE = partial(faces) - before;
			if (dE > 0 && rng() >= Math.exp(-dE / temp)) {
				flip(p);
			}
		}
	}

	let improved = true;
	while (improved) {
		improved = false;
		for (let p = 0; p < m; p++) {
			const faces = pairs[p];
			const before = partial(faces);
			flip(p);
			if (partial(faces) - before < -1e-9) {
				improved = true;
			} else {
				flip(p);
			}
		}
		for (let p1 = 0; p1 < m; p1++) {
			for (let p2 = p1 + 1; p2 < m; p2++) {
				const faces = [...pairs[p1], ...pairs[p2]];
				const before = partial(faces);
				swap(p1, p2);
				if (partial(faces) - before < -1e-9) {
					improved = true;
				} else {
					swap(p1, p2);
				}
			}
		}
	}

	const order = new Array<number>(n).fill(0);
	for (let i = 0; i < n; i++) {
		order[value[i] - 1] = i;
	}
	return order;
}

// ---------------------------------------------------------------------------
// drive the generation
// ---------------------------------------------------------------------------

// clear any orders already on file so build() falls back to raw build order;
// that's the order our generated indices are relative to.
for (const k of Object.keys(numberingOrders)) {
	delete numberingOrders[k];
}

type DieEntry = (typeof dice)[keyof typeof dice];

function buildOrderCentroids(die: DieEntry, handed: number): Array<Vector3> {
	const params: Record<string, number> = {};
	for (const p of die.parameters) {
		params[p.id] = p.defaultValue;
	}
	if (die.parameters.some((p) => p.id === 'handedness')) {
		params['handedness'] = handed;
	}
	const model = die.build(params);
	return model.faces
		.filter((f) => f.isNumberFace)
		.map((f) => f.transform.translation.clone());
}

const results: Array<{ id: string; n: number; value: NumberingOrder }> = [];
for (const id of CONVEX_POLYHEDRON_DICE) {
	const die = (dice as Record<string, DieEntry>)[id];
	if (!die) {
		throw new Error(`unknown die id: ${id}`);
	}
	const chiral = die.parameters.some((p) => p.id === 'handedness');
	if (chiral) {
		const left = balancedFaceOrder(buildOrderCentroids(die, 0));
		const right = balancedFaceOrder(buildOrderCentroids(die, 1));
		results.push({ id, n: left.length, value: [left, right] });
		console.log(`${id}: chiral, ${left.length} faces (left + right)`);
	} else {
		const order = balancedFaceOrder(buildOrderCentroids(die, 0));
		results.push({ id, n: order.length, value: order });
		console.log(`${id}: ${order.length} faces`);
	}
}

// ---------------------------------------------------------------------------
// emit the file
// ---------------------------------------------------------------------------

const fmt = (arr: Array<number>): string => `[${arr.join(', ')}]`;

const entries = results
	.map(({ id, n, value }) => {
		if (Array.isArray(value[0])) {
			const [left, right] = value as [Array<number>, Array<number>];
			return (
				`\t// ${id} (d${n}, chiral): [left, right]\n` +
				`\t${id}: [\n\t\t${fmt(left)},\n\t\t${fmt(right)}\n\t]`
			);
		}
		return `\t// ${id} (d${n})\n\t${id}: ${fmt(value as Array<number>)}`;
	})
	.join(',\n');

const header = `// Face numbering orders for the convex-polyhedron (isohedral) dice.
//
// AUTO-GENERATED by scripts/generate_numbering.ts - but safe to hand-tweak.
//
// Each entry maps a die id to a numbering order. An order is an array indexed by
// (value - 1) holding the BUILD-ORDER index of the face that should carry that
// value: order[0] is the build index of the face that gets a "1", order[1] the
// face that gets a "2", and so on. The build order is the order faces come out
// of the die builder (orbitFace), so this is purely a reshuffle applied after
// build - no geometry maths at runtime.
//
// Chiral dice store a pair [leftHanded, rightHanded] because their two mirror
// forms have different geometry.
//
// To regenerate after changing a die's geometry:
//   bunx vite-node scripts/generate_numbering.ts
// To tweak by hand: swap two entries to move those values onto each other's
// faces (keep each array a permutation of 0..n-1).

export type NumberingOrder = Array<number> | [Array<number>, Array<number>];

export const numberingOrders: Record<string, NumberingOrder> = {
${entries}
};
`;

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/dice/numbering_orders.ts');
writeFileSync(outPath, header);
console.log(`\nwrote ${outPath}`);
