// Arrange die cavities across the floor of a box half. The dice are split, in
// order, across a chosen number of rows (larger rows first). Unlike a uniform
// grid, each die occupies only its own footprint width, so a small die next to a
// large one doesn't inherit the large cell - this keeps the packing (and the
// box) tight. Within a row the dice butt up with the user gap between them; rows
// are stacked with the same gap and the whole field is centred on the origin.
// Returns each die's centre (x,y) plus the overall field extent, in the Z-up box
// frame.

import { Vector2 } from 'three';

export type LayoutItem = {
	dieId: string;
	// laid-flat footprint (x,y) of the die's cavity (its projected bounding box).
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

	// split into `r` rows as evenly as possible, larger rows first.
	const r = Math.min(Math.max(1, Math.round(rows)), n);
	const base = Math.floor(n / r);
	const remainder = n % r;
	const counts = Array.from({ length: r }, (_, i) => base + (i < remainder ? 1 : 0));

	// assign items to rows in order.
	const rowItems: Array<Array<LayoutItem>> = [];
	let idx = 0;
	for (let row = 0; row < r; row++) {
		rowItems.push(items.slice(idx, idx + counts[row]));
		idx += counts[row];
	}

	const rowWidth = (its: Array<LayoutItem>) =>
		its.reduce((s, it) => s + it.footprint.x, 0) + gap * Math.max(0, its.length - 1);
	const rowHeight = (its: Array<LayoutItem>) =>
		its.reduce((m, it) => Math.max(m, it.footprint.y), 0);

	const heights = rowItems.map(rowHeight);
	const totalHeight = heights.reduce((s, h) => s + h, 0) + gap * Math.max(0, r - 1);

	let maxRowWidth = 0;
	// rows run from +y (top) to -y (bottom); the whole stack is centred on y = 0.
	let yTop = totalHeight / 2;
	for (let row = 0; row < r; row++) {
		const its = rowItems[row];
		const h = heights[row];
		const yc = yTop - h / 2;
		yTop -= h + gap;

		const w = rowWidth(its);
		maxRowWidth = Math.max(maxRowWidth, w);
		// each row is centred on x = 0 independently.
		let xLeft = -w / 2;
		for (const it of its) {
			const xc = xLeft + it.footprint.x / 2;
			xLeft += it.footprint.x + gap;
			positions.set(it.dieId, new Vector2(xc, yc));
		}
	}

	return { positions, field: new Vector2(maxRowWidth, totalHeight) };
}
