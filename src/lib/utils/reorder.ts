// Pure helpers for reordering a list from a pointer position. The dice strip
// uses these so a drag can pick a slot from layout rects without depending on
// the live DOM (hover scales change getBoundingClientRect but not offsets).

export type RectLike = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

export function closestRectIndex(
	pointer: { x: number; y: number },
	rects: Array<RectLike>
): number {
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < rects.length; i++) {
		const r = rects[i];
		const dx = pointer.x - (r.left + r.right) / 2;
		const dy = pointer.y - (r.top + r.bottom) / 2;
		const dist = dx * dx + dy * dy;
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

// Flex `order` for a die that stays visible while the die at `from` is dragged
// toward `target`. The dragged die leaves the flow and a ghost occupies
// `target`, so the remaining dice shift aside to show the landing slot.
// `target` is the index `moveItem(from, target)` will land on.
export function reorderSlot(index: number, from: number, target: number): number {
	const without = index > from ? index - 1 : index;
	return without >= target ? without + 1 : without;
}

// Move the item at `from` so it lands at `to`. Both indexes are in the array
// as it stands before the move (the destination slot the pointer is over).
export function moveItem<T>(items: Array<T>, from: number, to: number): void {
	if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
		return;
	}
	const [item] = items.splice(from, 1);
	items.splice(to, 0, item);
}
