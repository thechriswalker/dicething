import { describe, it, expect } from 'vitest';
import dice from '$lib/dice';
import { Legend } from '$lib/utils/legends';
import { applyOrderingToFaces } from '$lib/utils/legend_orderings';
import type { DieFaceModel } from '$lib/interfaces/dice';

function legendValue(l: number): number {
	if (l === Legend.SIX_MARKED) return 6;
	if (l === Legend.NINE_MARKED) return 9;
	return l;
}

function neighborValuesCCW(faces: Array<DieFaceModel>, i: number): Array<number> {
	const dirs = faces.map((f) => f.transform.translation.clone().normalize());
	const me = dirs[i];
	const scored = dirs
		.map((d, j) => ({ j, dist: me.distanceTo(d) }))
		.filter((x) => x.j !== i)
		.sort((a, b) => a.dist - b.dist)
		.slice(0, 5);
	const ref = scored[0].j;
	const refT = dirs[ref].clone().sub(me.clone().multiplyScalar(dirs[ref].dot(me)));
	const angled = scored.map(({ j }) => {
		const t = dirs[j].clone().sub(me.clone().multiplyScalar(dirs[j].dot(me)));
		const cross = refT.clone().cross(t);
		let ang = Math.atan2(cross.dot(me), refT.dot(t));
		if (ang < 0) ang += Math.PI * 2;
		return { j, ang };
	});
	angled.sort((a, b) => a.ang - b.ang);
	return angled.map((a) => legendValue(faces[a.j].defaultLegend as number));
}

function sameCycle(a: Array<number>, b: Array<number>): boolean {
	if (a.length !== b.length) return false;
	for (let rot = 0; rot < a.length; rot++) {
		const rotated = [...b.slice(rot), ...b.slice(0, rot)];
		if (rotated.every((v, i) => v === a[i])) return true;
		const rev = [...rotated].reverse();
		// after reverse, re-align start
		const i0 = rev.indexOf(a[0]);
		if (i0 >= 0) {
			const aligned = [...rev.slice(i0), ...rev.slice(0, i0)];
			if (aligned.every((v, i) => v === a[i])) return true;
		}
	}
	return false;
}

function build(kind: keyof typeof dice, params: Record<string, number> = {}): Array<DieFaceModel> {
	const model = dice[kind];
	const p: Record<string, number> = {};
	for (const param of model.parameters) p[param.id] = param.defaultValue;
	Object.assign(p, params);
	return model.build(p).faces.filter((f) => f.isNumberFace);
}

describe('d12 Bosch / Dicething / Chessex layouts', () => {
	it('standard (Bosch) puts 2,6,3,4,5 around 12 on both regular and skew d12', () => {
		const boschAround12 = [2, 6, 3, 4, 5];
		for (const kind of ['d12_dodecahedron', 'd12_tetartoid'] as const) {
			const faces = build(kind);
			expect(faces.map((f) => legendValue(f.defaultLegend as number))).toEqual([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
			]);
			const i12 = faces.findIndex((f) => legendValue(f.defaultLegend as number) === 12);
			expect(sameCycle(neighborValuesCCW(faces, i12), boschAround12)).toBe(true);
		}
	});

	it('Dicething puts evens around 1 and odds around 12', () => {
		for (const kind of ['d12_dodecahedron', 'd12_tetartoid'] as const) {
			const faces = build(kind);
			applyOrderingToFaces(kind, 'dicething', faces, {});
			const i1 = faces.findIndex((f) => legendValue(f.defaultLegend as number) === 1);
			const i12 = faces.findIndex((f) => legendValue(f.defaultLegend as number) === 12);
			expect(neighborValuesCCW(faces, i1).every((v) => v % 2 === 0)).toBe(true);
			expect(neighborValuesCCW(faces, i12).every((v) => v % 2 === 1)).toBe(true);
		}
	});

	it('Chessex puts 2..6 around 1 and 7..11 around 12', () => {
		for (const kind of ['d12_dodecahedron', 'd12_tetartoid'] as const) {
			const faces = build(kind);
			applyOrderingToFaces(kind, 'chessex', faces, {});
			const i1 = faces.findIndex((f) => legendValue(f.defaultLegend as number) === 1);
			const i12 = faces.findIndex((f) => legendValue(f.defaultLegend as number) === 12);
			expect(new Set(neighborValuesCCW(faces, i1))).toEqual(new Set([2, 3, 4, 5, 6]));
			expect(new Set(neighborValuesCCW(faces, i12))).toEqual(new Set([7, 8, 9, 10, 11]));
		}
	});
});
