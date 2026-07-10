import { describe, it, expect } from 'vitest';
import { Vector2 } from 'three';
import dice from '$lib/dice';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import { prepareLayout } from './box_builder';
import { defaultBoxParams, type BoxConfig } from './types';

function makeDie(kind: keyof typeof dice, parameters?: Record<string, number>): Dice {
	const model = dice[kind];
	const params: Record<string, number> = {};
	for (const p of model.parameters) {
		params[p.id] = p.defaultValue;
	}
	Object.assign(params, parameters);
	return { id: kind, kind, parameters: params, face_parameters: [] };
}

function makeSet(kinds: Array<keyof typeof dice>): DiceSet {
	return {
		id: 'test',
		name: 'test',
		updated: 0,
		dice: kinds.map((k) => makeDie(k)),
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

function zeroLengthEdgeCount(hull: Array<Vector2>): number {
	let count = 0;
	for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
		const dx = hull[i].x - hull[j].x;
		const dy = hull[i].y - hull[j].y;
		if (dx * dx + dy * dy < 1e-8) {
			count++;
		}
	}
	return count;
}

function polysOverlap(a: Array<Vector2>, b: Array<Vector2>): boolean {
	const EPS = 1e-3;
	for (const poly of [a, b]) {
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const nx = -(poly[i].y - poly[j].y);
			const ny = poly[i].x - poly[j].x;
			if (nx * nx + ny * ny < 1e-12) {
				continue;
			}
			let minA = Infinity;
			let maxA = -Infinity;
			let minB = Infinity;
			let maxB = -Infinity;
			for (const p of a) {
				const d = p.x * nx + p.y * ny;
				minA = Math.min(minA, d);
				maxA = Math.max(maxA, d);
			}
			for (const p of b) {
				const d = p.x * nx + p.y * ny;
				minB = Math.min(minB, d);
				maxB = Math.max(maxB, d);
			}
			if (maxA < minB + EPS || maxB < minA + EPS) {
				return false;
			}
		}
	}
	return true;
}

function placedHull(hull0: Array<Vector2>, x: number, y: number): Array<Vector2> {
	return hull0.map((p) => new Vector2(p.x + x, p.y + y));
}

describe('box layout hulls', () => {
	it('avoids zero-length edges on classic dice hulls', async () => {
		const set = makeSet([
			'd4_caltrop',
			'd6_cube',
			'd8_trapezohedron',
			'd10_trapezohedron',
			'd00_trapezohedron',
			'd12_dodecahedron',
			'd20_icosahedron'
		]);
		const prep = await prepareLayout(set, makeConfig(set));
		for (const d of prep.dice) {
			expect(zeroLengthEdgeCount(d.hull0)).toBe(0);
		}
	});

	it('detects overlap when dice share a centre', async () => {
		const set = makeSet(['d6_cube', 'd8_trapezohedron', 'd20_icosahedron']);
		const prep = await prepareLayout(set, makeConfig(set));
		for (let i = 0; i < prep.dice.length; i++) {
			for (let j = i + 1; j < prep.dice.length; j++) {
				const a = placedHull(prep.dice[i].hull0, 0, 0);
				const b = placedHull(prep.dice[j].hull0, 0, 0);
				expect(polysOverlap(a, b)).toBe(true);
			}
		}
	});
});
