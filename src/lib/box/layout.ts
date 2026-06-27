// Arrange die cavities across the floor of a box half. The dice are split, in
// order, across a chosen number of rows (larger rows first) and each row is
// centred relative to the others. Uniform cells (sized to the largest die
// footprint) keep the spacing even. Returns each die's centre (x,y) plus the
// overall field extent, both in the Z-up box frame.

import { Vector2 } from 'three';

export type LayoutItem = {
	dieId: string;
	// laid-flat footprint (x,y) of the die's cavity.
	footprint: Vector2;
};

export type LayoutResult = {
	// die id -> centre position in the field (origin at field centre).
	positions: Map<string, Vector2>;
	// total field size (x,y) the cavities occupy.
	field: Vector2;
};

export function layoutDice(items: Array<LayoutItem>, gap: number, rows = 1): LayoutResult {
	const positions = new Map<string, Vector2>();
	const n = items.length;
	if (n === 0) {
		return { positions, field: new Vector2(0, 0) };
	}

	// uniform cell sized to the biggest footprint in the set.
	let cellW = 0;
	let cellD = 0;
	for (const it of items) {
		cellW = Math.max(cellW, it.footprint.x);
		cellD = Math.max(cellD, it.footprint.y);
	}
	cellW += gap;
	cellD += gap;

	// split into `r` rows as evenly as possible, larger rows first.
	const r = Math.min(Math.max(1, Math.round(rows)), n);
	const base = Math.floor(n / r);
	const remainder = n % r;
	const counts = Array.from({ length: r }, (_, i) => base + (i < remainder ? 1 : 0));
	const maxCount = Math.max(...counts);

	const fieldW = maxCount * cellW;
	const fieldD = r * cellD;

	let idx = 0;
	for (let row = 0; row < r; row++) {
		const count = counts[row];
		const y = (row - (r - 1) / 2) * cellD;
		for (let col = 0; col < count; col++) {
			// centre each row about x = 0 independently.
			const x = (col - (count - 1) / 2) * cellW;
			positions.set(items[idx].dieId, new Vector2(x, y));
			idx++;
		}
	}
	return { positions, field: new Vector2(fieldW, fieldD) };
}
