import { describe, it, expect } from 'vitest';
import dice from '$lib/dice';
import {
	getOrderings,
	applyOrderingToFaces,
	resolveOrdering,
	STANDARD_ORDERING,
	CUSTOM_ORDERING
} from '$lib/utils/legend_orderings';
import { legendForValue, pickForDoublesByIndex } from '$lib/utils/legends';
import { spindownOrders } from '$lib/utils/spindown_orders';
import type { DieFaceModel } from '$lib/interfaces/dice';

function buildFaces(kind: keyof typeof dice): Array<DieFaceModel> {
	return dice[kind].build({}).faces;
}

// the values Go First (A) puts on a d12, in face order.
const GO_FIRST_A = [1, 8, 11, 14, 19, 22, 27, 30, 35, 38, 41, 48];

describe('legend orderings registry', () => {
	it('offers Spindown only when the die has an entry in spindownOrders', () => {
		const d6 = getOrderings('d6_cube').map((o) => o.id);
		expect(d6).toEqual(['standard', 'spindown']);

		const d4Caltrop = getOrderings('d4_caltrop').map((o) => o.id);
		expect(d4Caltrop).toEqual(['standard']);

		const d20 = getOrderings('d20_icosahedron').map((o) => o.id);
		expect(d20).toEqual(['standard', 'spindown']);
	});

	it('offers Percentile on 10-sided kinds (including legacy d00)', () => {
		expect(getOrderings('d10_trapezohedron').map((o) => o.id)).toEqual([
			'standard',
			'percentile'
		]);
		expect(getOrderings('d00_trapezohedron').map((o) => o.id)).toEqual([
			'standard',
			'percentile'
		]);
		expect(getOrderings('d10_crystal').map((o) => o.id)).toEqual([
			'standard',
			'percentile',
			'spindown'
		]);
		expect(getOrderings('d10_trapezohedron').map((o) => o.labelKey)).toEqual([
			'standard_d10',
			'standard_percentile'
		]);
	});

	it('offers Dicething / Chessex / Go First on Bosch d12s', () => {
		const d12 = getOrderings('d12_dodecahedron').map((o) => o.id);
		expect(d12).toEqual([
			'standard',
			'dicething',
			'chessex',
			'spindown',
			'go_first_a',
			'go_first_b',
			'go_first_c',
			'go_first_d'
		]);
		expect(getOrderings('d12_dodecahedron').map((o) => o.labelKey)[0]).toBe('standard_bosch');
		expect(getOrderings('d12_tetartoid').map((o) => o.id)).toEqual([
			'standard',
			'dicething',
			'chessex',
			'go_first_a',
			'go_first_b',
			'go_first_c',
			'go_first_d'
		]);
	});

	it('Go First is offered on the other 12-sided shapes too (without Dicething/Chessex)', () => {
		for (const kind of ['d12_rhombic', 'd12_trapezohedron', 'd12_crystal'] as const) {
			const ids = getOrderings(kind).map((o) => o.id);
			expect(ids).toContain('go_first_a');
			expect(ids).not.toContain('dicething');
			expect(ids).not.toContain('chessex');
		}
	});

	it('resolveOrdering returns undefined for standard/custom/unknown', () => {
		expect(resolveOrdering('d12_dodecahedron', STANDARD_ORDERING)).toBeUndefined();
		expect(resolveOrdering('d12_dodecahedron', CUSTOM_ORDERING)).toBeUndefined();
		expect(resolveOrdering('d12_dodecahedron', undefined)).toBeUndefined();
		expect(resolveOrdering('d12_dodecahedron', 'nope')).toBeUndefined();
		expect(resolveOrdering('d4_caltrop', 'spindown')).toBeUndefined();
	});
});

describe('applyOrderingToFaces', () => {
	it('Go First (A) assigns the expected legends to the d12 number faces', () => {
		const faces = buildFaces('d12_dodecahedron');
		applyOrderingToFaces('d12_dodecahedron', 'go_first_a', faces, {});
		expect(faces.map((f) => f.defaultLegend)).toEqual(GO_FIRST_A.map((v) => legendForValue(v)));
	});

	it('standard / custom / unknown leave the default legends untouched', () => {
		const baseline = buildFaces('d12_dodecahedron').map((f) => f.defaultLegend);
		for (const id of [STANDARD_ORDERING, CUSTOM_ORDERING, 'nope', undefined]) {
			const faces = buildFaces('d12_dodecahedron');
			applyOrderingToFaces('d12_dodecahedron', id, faces, {});
			expect(faces.map((f) => f.defaultLegend)).toEqual(baseline);
		}
	});

	it('Spindown applies the authored arrangement when data exists', () => {
		const faces = buildFaces('d6_cube');
		applyOrderingToFaces('d6_cube', 'spindown', faces, {});
		expect(faces.map((f) => f.defaultLegend)).toEqual(spindownOrders.d6_cube);
	});

	it('Dicething / Chessex remap d12 number faces from the Bosch baseline', () => {
		const dicething = buildFaces('d12_dodecahedron');
		applyOrderingToFaces('d12_dodecahedron', 'dicething', dicething, {});
		expect(dicething.map((f) => f.defaultLegend)).toEqual(
			[1, 3, 11, 5, 9, 7, 6, 4, 8, 2, 10, 12].map((v) => legendForValue(v))
		);

		const chessex = buildFaces('d12_tetartoid');
		applyOrderingToFaces('d12_tetartoid', 'chessex', chessex, {});
		expect(chessex.map((f) => f.defaultLegend)).toEqual(
			[1, 8, 11, 10, 9, 7, 6, 4, 3, 2, 5, 12].map((v) => legendForValue(v))
		);
	});

	it('Spindown on a die without authored data is a no-op (ordering not offered)', () => {
		const baseline = buildFaces('d8_trapezohedron').map((f) => f.defaultLegend);
		const faces = buildFaces('d8_trapezohedron');
		applyOrderingToFaces('d8_trapezohedron', 'spindown', faces, {});
		expect(faces.map((f) => f.defaultLegend)).toEqual(baseline);
	});

	it('Percentile remaps a d10 to tens legends', () => {
		const faces = buildFaces('d10_trapezohedron');
		applyOrderingToFaces('d10_trapezohedron', 'percentile', faces, {});
		expect(faces.filter((f) => f.isNumberFace).map((f) => f.defaultLegend)).toEqual(
			Array.from({ length: 10 }, (_, i) => pickForDoublesByIndex(i))
		);
	});
});
