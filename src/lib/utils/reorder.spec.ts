import { describe, expect, it } from 'vitest';
import { closestRectIndex, moveItem, reorderSlot, type RectLike } from './reorder';

function rect(left: number, top: number, size = 64): RectLike {
	return { left, top, right: left + size, bottom: top + size };
}

describe('closestRectIndex', () => {
	const row = [rect(0, 0), rect(80, 0), rect(160, 0), rect(0, 80)];

	it('picks the tile whose centre is nearest the pointer', () => {
		expect(closestRectIndex({ x: 10, y: 10 }, row)).toBe(0);
		expect(closestRectIndex({ x: 100, y: 20 }, row)).toBe(1);
		expect(closestRectIndex({ x: 190, y: 10 }, row)).toBe(2);
	});

	it('follows the pointer onto the next wrapped row', () => {
		expect(closestRectIndex({ x: 20, y: 100 }, row)).toBe(3);
	});

	it('returns 0 when there are no rects', () => {
		expect(closestRectIndex({ x: 0, y: 0 }, [])).toBe(0);
	});
});

describe('reorderSlot', () => {
	// visible orders plus the ghost at `target` cover 0..n-1 exactly once.
	function laidOut(count: number, from: number, target: number): Array<number> {
		const slots: Array<number> = [];
		for (let i = 0; i < count; i++) {
			if (i !== from) {
				slots.push(reorderSlot(i, from, target));
			}
		}
		slots.push(target);
		return slots.sort((a, b) => a - b);
	}

	it('shifts the other dice around the landing slot', () => {
		expect(reorderSlot(0, 1, 3)).toBe(0);
		expect(reorderSlot(2, 1, 3)).toBe(1);
		expect(reorderSlot(3, 1, 3)).toBe(2);
		expect(reorderSlot(0, 1, 0)).toBe(1);
		expect(reorderSlot(1, 0, 2)).toBe(0);
		expect(reorderSlot(3, 0, 2)).toBe(3);
	});

	it('keeps a unique slot for every die and the ghost', () => {
		expect(laidOut(4, 1, 3)).toEqual([0, 1, 2, 3]);
		expect(laidOut(4, 0, 2)).toEqual([0, 1, 2, 3]);
		expect(laidOut(4, 3, 1)).toEqual([0, 1, 2, 3]);
		expect(laidOut(4, 2, 2)).toEqual([0, 1, 2, 3]);
	});
});

describe('moveItem', () => {
	it('moves an earlier item into a later slot', () => {
		const items = ['a', 'b', 'c', 'd'];
		moveItem(items, 0, 2);
		expect(items).toEqual(['b', 'c', 'a', 'd']);
	});

	it('moves a later item into an earlier slot', () => {
		const items = ['a', 'b', 'c', 'd'];
		moveItem(items, 3, 1);
		expect(items).toEqual(['a', 'd', 'b', 'c']);
	});

	it('leaves the list alone for a no-op or an out-of-range index', () => {
		const items = ['a', 'b'];
		moveItem(items, 1, 1);
		moveItem(items, -1, 0);
		moveItem(items, 0, 5);
		expect(items).toEqual(['a', 'b']);
	});
});
