import { describe, it, expect } from 'vitest';
import dice from './index';
import {
	getOrderings,
	applyOrderingToFaces,
	resolveOrdering,
	STANDARD_ORDERING,
	CUSTOM_ORDERING
} from './legend_orderings';
import { legendForValue } from '$lib/utils/legends';
import { spindownOrders } from './spindown_orders';
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
		expect(d20).toEqual(['standard']);
	});

	it('offers Go First A-D on 12-sided dice', () => {
		const d12 = getOrderings('d12_dodecahedron').map((o) => o.id);
		expect(d12).toEqual([
			'standard',
			'spindown',
			'go_first_a',
			'go_first_b',
			'go_first_c',
			'go_first_d'
		]);
	});

	it('Go First is offered on the other 12-sided shapes too', () => {
		for (const kind of ['d12_rhombic', 'd12_trapezohedron', 'd12_crystal'] as const) {
			expect(getOrderings(kind).map((o) => o.id)).toContain('go_first_a');
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

	it('Spindown on a die without authored data is a no-op (ordering not offered)', () => {
		const baseline = buildFaces('d20_icosahedron').map((f) => f.defaultLegend);
		const faces = buildFaces('d20_icosahedron');
		applyOrderingToFaces('d20_icosahedron', 'spindown', faces, {});
		expect(faces.map((f) => f.defaultLegend)).toEqual(baseline);
	});
});
