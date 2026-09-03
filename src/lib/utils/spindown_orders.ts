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
	// consecutive values around the band (azimuth order), vs standard opposite-sum placement
	d12_crystal: [7, 4, 8, 11, 21, 3, 22, 12, 5, 2, 10, 1],
	d12_dodecahedron: [1, 8, 10, 11, 7, 22, 21, 4, 3, 2, 5, 12],
	// same Bosch face order / adjacency as d12_dodecahedron
	d12_tetartoid: [1, 8, 10, 11, 7, 22, 21, 4, 3, 2, 5, 12],
	d12_rhombic: [1, 7, 10, 22, 11, 21, 2, 3, 5, 4, 12, 8],
	d20_icosahedron: [1, 19, 4, 17, 9, 15, 2, 13, 21, 12, 7, 11, 8, 16, 10, 14, 3, 18, 5, 20],

	// barrels: remap so azimuth slots show 1..N (standard uses opposite-sum slot values)
	d4_barrel: [1, 2, 4, 3],
	d6_barrel: [1, 2, 3, 6, 5, 4],
	d8_barrel: [1, 2, 3, 4, 8, 7, 6, 5],
	d10_barrel: [1, 2, 3, 4, 5, 0, 22, 8, 7, 21],
	d00_barrel: [10, 20, 23, 24, 25, 30, 29, 28, 27, 26],
	d12_barrel: [1, 2, 3, 4, 5, 21, 12, 11, 10, 22, 8, 7],
	d20_barrel: [1, 2, 3, 4, 5, 21, 7, 8, 22, 10, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11]
};
