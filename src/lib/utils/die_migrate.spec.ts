import { describe, it, expect } from 'vitest';
import {
	migrateLegacyDie,
	migrateLegacyDice,
	resolvePickerSelection
} from '$lib/utils/die_migrate';
import type { Dice } from '$lib/interfaces/storage.svelte';
import { CUSTOM_ORDERING, PERCENTILE_ORDERING, STANDARD_ORDERING } from '$lib/utils/legend_orderings';
import { spindownOrders } from '$lib/utils/spindown_orders';

function die(partial: Partial<Dice> & Pick<Dice, 'kind'>): Dice {
	return {
		id: 'x',
		parameters: {},
		face_parameters: [],
		...partial
	};
}

describe('migrateLegacyDie', () => {
	it('leaves d10 dice alone', () => {
		const d = die({ kind: 'd10_trapezohedron', legend_ordering: STANDARD_ORDERING });
		expect(migrateLegacyDie(d)).toBe(d);
	});

	it('maps d00 standard → d10 percentile', () => {
		const next = migrateLegacyDie(die({ kind: 'd00_trapezohedron' }));
		expect(next.kind).toBe('d10_trapezohedron');
		expect(next.legend_ordering).toBe(PERCENTILE_ORDERING);
	});

	it('maps d00 units → d10 standard', () => {
		const next = migrateLegacyDie(
			die({ kind: 'd00_crystal', legend_ordering: 'units' })
		);
		expect(next.kind).toBe('d10_crystal');
		expect(next.legend_ordering).toBe(STANDARD_ORDERING);
	});

	it('bakes d00 spindown into custom on d10', () => {
		const next = migrateLegacyDie(
			die({ kind: 'd00_crystal', legend_ordering: 'spindown' })
		);
		expect(next.kind).toBe('d10_crystal');
		expect(next.legend_ordering).toBe(CUSTOM_ORDERING);
		const expected = spindownOrders.d00_crystal;
		const got = next.face_parameters
			.map((fp) => fp.legend)
			.filter((l): l is number => l !== undefined);
		expect(got).toEqual(expected);
	});

	it('keeps custom ordering when rewriting kind', () => {
		const next = migrateLegacyDie(
			die({
				kind: 'd00_barrel',
				legend_ordering: CUSTOM_ORDERING,
				face_parameters: [{ legend: 10 }]
			})
		);
		expect(next.kind).toBe('d10_barrel');
		expect(next.legend_ordering).toBe(CUSTOM_ORDERING);
		expect(next.face_parameters[0].legend).toBe(10);
	});
});

describe('resolvePickerSelection', () => {
	it('adds d00 picker tiles as d10 + percentile', () => {
		expect(resolvePickerSelection('d00_trapezohedron')).toEqual({
			kind: 'd10_trapezohedron',
			legend_ordering: PERCENTILE_ORDERING
		});
		expect(resolvePickerSelection('d10_trapezohedron')).toEqual({
			kind: 'd10_trapezohedron',
			legend_ordering: STANDARD_ORDERING
		});
	});
});

describe('migrateLegacyDice', () => {
	it('reports unchanged when nothing to migrate', () => {
		const list = [die({ kind: 'd6_cube' })];
		const { dice, changed } = migrateLegacyDice(list);
		expect(changed).toBe(false);
		expect(dice).toBe(list);
	});
});
