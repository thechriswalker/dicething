import { describe, expect, it } from 'vitest';
import type { Dice } from '$lib/interfaces/storage.svelte';
import { defaultBoxParams } from './types';
import {
	backfillBoxNames,
	boxForRouteParam,
	defaultBoxConfig,
	deleteBoxIn,
	listBoxesIn,
	loadBoxIn,
	reconcileBoxConfig,
	saveBoxIn,
	uniqueBoxName,
	type BoxStorage
} from './store';

function memoryStorage(): BoxStorage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, String(value));
		},
		removeItem: (key) => {
			map.delete(key);
		},
		key: (index) => [...map.keys()][index] ?? null
	};
}

function die(id: string): Dice {
	return { id, kind: 'd6_cube', parameters: {}, face_parameters: [] };
}

describe('box store', () => {
	it('keeps several boxes for one set', () => {
		const store = memoryStorage();
		const dice = [die('a'), die('b')];
		const thin = saveBoxIn(store, defaultBoxConfig('set', dice, 'Thin', 'box-thin'));
		const fat = saveBoxIn(store, defaultBoxConfig('set', dice, 'Fat', 'box-fat'));
		expect(thin.id).not.toBe(fat.id);
		expect(
			listBoxesIn(store)
				.map((b) => b.id)
				.sort()
		).toEqual(['box-fat', 'box-thin']);
		expect(loadBoxIn(store, 'box-thin')?.name).toBe('Thin');
		deleteBoxIn(store, 'box-thin');
		expect(listBoxesIn(store).map((b) => b.id)).toEqual(['box-fat']);
		expect(loadBoxIn(store, 'box-thin')).toBeUndefined();
	});

	it('adopts a legacy set-keyed record as a box with that id', () => {
		const store = memoryStorage();
		store.setItem(
			'dt:boxes:set-1',
			JSON.stringify({
				setId: 'set-1',
				updated: 10,
				params: { wall: 2, magnets: { enabled: false } },
				placements: [{ dieId: 'd', order: 0, rotation: 0, include: true }]
			})
		);
		const listed = listBoxesIn(store);
		expect(listed).toHaveLength(1);
		expect(listed[0].id).toBe('set-1');
		expect(listed[0].setId).toBe('set-1');
		expect(listed[0].name).toBe('');
		expect(listed[0].params.wall).toBe(2);
		expect(listed[0].params.floor).toBe(defaultBoxParams().floor);
		expect(listed[0].params.magnets.enabled).toBe(false);
		expect(listed[0].params.magnets.diameter).toBe(defaultBoxParams().magnets.diameter);
		expect(listed[0].placements[0].x).toBe(0);
		expect(listed[0].placements[0].y).toBe(0);
		const raw = store.getItem('dt:boxes:set-1');
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw!).id).toBe('set-1');
		expect(store.getItem('dt:boxes:set-1')).toBe(raw);
		expect(listBoxesIn(store)[0].id).toBe('set-1');
		expect(store.getItem('dt:boxes:set-1')).toBe(raw);
	});

	it('skips records that are not a box', () => {
		const store = memoryStorage();
		store.setItem('dt:boxes:bad', '{');
		store.setItem('dt:boxes:nope', JSON.stringify({ setId: 'x' }));
		expect(listBoxesIn(store)).toEqual([]);
	});

	it('disambiguates names and backfills blanks from the set name', () => {
		expect(uniqueBoxName('Travel', [])).toBe('Travel');
		expect(uniqueBoxName('Travel', ['Travel'])).toBe('Travel 2');
		expect(uniqueBoxName('Travel', ['Travel', 'Travel 2'])).toBe('Travel 3');
		expect(uniqueBoxName('  ', [])).toBe('Box');

		const dice = [die('a')];
		const named = defaultBoxConfig('set', dice, 'Travel', 'kept');
		const blankA = defaultBoxConfig('set', dice, '', 'a');
		const blankB = defaultBoxConfig('set', dice, '  ', 'b');
		const saved: Array<string> = [];
		const next = backfillBoxNames(
			[named, blankA, blankB],
			() => 'Travel',
			(config) => {
				saved.push(config.id);
				return { ...config, updated: 5 };
			}
		);
		expect(saved).toEqual(['a', 'b']);
		expect(next.map((b) => b.name)).toEqual(['Travel', 'Travel 2', 'Travel 3']);
		expect(named.name).toBe('Travel');
	});

	it('reconcile keeps the box identity and appends new dice', () => {
		const config = defaultBoxConfig('set', [die('a')], 'Box', 'box');
		config.placements[0].include = false;
		const next = reconcileBoxConfig(config, [die('a'), die('b')]);
		expect(next.id).toBe('box');
		expect(next.name).toBe('Box');
		expect(next.placements.map((p) => p.dieId)).toEqual(['a', 'b']);
		expect(next.placements[0].include).toBe(false);
		expect(next.placements[1].include).toBe(true);
	});

	it('opens a box by id, or a set id when that set has one box', () => {
		const dice = [die('a')];
		const only = defaultBoxConfig('set', dice, 'Only', 'box-1');
		const other = defaultBoxConfig('other', dice, 'Other', 'box-2');
		expect(boxForRouteParam([only, other], 'box-2')?.name).toBe('Other');
		expect(boxForRouteParam([only], 'set')?.id).toBe('box-1');
		const second = defaultBoxConfig('set', dice, 'Second', 'box-3');
		expect(boxForRouteParam([only, second], 'set')).toBeUndefined();
		expect(boxForRouteParam([only], 'missing')).toBeUndefined();
	});
});
