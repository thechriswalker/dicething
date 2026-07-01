// Per-die "spindown" legend arrangements.
//
// A spindown layout puts consecutive numbers on physically adjacent faces, so
// the die can be turned over one face at a time in numeric order. That layout
// is shape-specific (it depends on each die's face adjacency), so rather than
// computing it, we store an explicit array per die kind and hand-author it.
//
// Each entry maps a die id to an array indexed by NUMBER-FACE position (in the
// die's standard build order, i.e. the order number faces come out of
// `DieModel.build()`). The value is the `Legend` slot that face should show.
//
// Authoring workflow: enable developer mode, open a die, arrange its faces
// visually (this flips the die to the "custom" ordering), then use the
// "Copy ordering" button in the dice parameters panel to copy a paste-ready
// line for this file.
//
// Only dice with a key here are offered a "Spindown" ordering in the UI.
// Shapes that are already spindown-like by default (e.g. caltrops) are left
// out. An entry whose length doesn't match the die's number-face count falls
// back to the standard ordering at apply time.

import type { Legend } from '$lib/utils/legends';

export const spindownOrders: Record<string, Array<Legend>> = {
	d6_cube: [1, 2, 3, 5, 4, 6],
	d4_crystal: [1, 2, 4, 3],
	d6_crystal: [1, 3, 2, 5, 6, 4],
	d8_crystal: [1, 7, 2, 4, 8, 6, 3, 5],
	d10_crystal: [1, 4, 2, 8, 0, 5, 3, 7, 22, 21],
	d00_crystal: [10, 24, 20, 28, 30, 25, 23, 27, 29, 26],
	d12_dodecahedron: [1, 2, 8, 4, 11, 21, 22, 3, 7, 5, 10, 12]
};
