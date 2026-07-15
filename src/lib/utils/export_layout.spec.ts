import { describe, it, expect } from 'vitest';
import {
	buildExportMeshes,
	checkExportMesh,
	disposeNamedManifolds,
	layoutNamedMeshes
} from './export';
import { loadImmutableLegends, type SerialisedLegendSet } from './legends';
import tektur from '../fonts/generated/tektur.json';
import germania from '../fonts/generated/germania_one.json';
import alice from '../fonts/generated/alice_in_wonderland.json';
import type { DiceSet } from '../interfaces/storage.svelte';

function makeSet(): DiceSet {
	const legends = loadImmutableLegends(tektur as unknown as SerialisedLegendSet);
	return {
		id: 'test',
		name: 'test',
		updated: 0,
		legends,
		dice: [
			{
				id: 'd24',
				kind: 'd24_deltoidal_icositetrahedron',
				parameters: {},
				face_parameters: Array.from({ length: 24 }, () => ({}))
			},
			{
				id: 'd6',
				kind: 'd6_cube',
				parameters: {},
				face_parameters: Array.from({ length: 6 }, () => ({}))
			}
		]
	} as unknown as DiceSet;
}

// A die that checks out as a printable solid on its own must keep checking out
// when it is laid out next to another die (i.e. translated into a grid cell).
// Regression for the mesh-check weld being sensitive to absolute position.
describe('laid-out dice stay printable', () => {
	function expectAllPrintable(named: ReturnType<typeof buildExportMeshes>) {
		layoutNamedMeshes(named);
		try {
			for (const n of named) {
				const r = checkExportMesh(n);
				expect(r.boundaryEdgeCount, `${n.name} boundary edges`).toBe(0);
				expect(r.nonManifoldEdgeCount, `${n.name} non-manifold edges`).toBe(0);
				expect(r.degenerateTriangleCount, `${n.name} degenerate triangles`).toBe(0);
				expect(r.isPrintable, `${n.name} printable`).toBe(true);
			}
		} finally {
			disposeNamedManifolds(named);
		}
	}
	it('D24 + D6 are both watertight/manifold after layoutGrid', () => {
		expectAllPrintable(buildExportMeshes(makeSet(), { selectedIds: ['d24', 'd6'] }));
	});

	// Regression: platform artifacts must stay printable when laid out alongside dice.
	it('D6 platform artifact is a printable solid', () => {
		const named = buildExportMeshes(makeSet(), {
			selectedIds: ['d6'],
			includeDice: false,
			optionStates: { platforms: { enabled: true, values: {} } }
		});
		expect(named.length, 'one platform artifact').toBe(1);
		expectAllPrintable(named);
	});

	// Reported case: a germania_one deltoidal D24 with non-default engraving picks
	// up a sub-micron, near-collinear sliver from the glyph tessellation. The
	// sliver's Float32 area sits right on the old degenerate threshold, so the D24
	// flipped between printable and "3 open edges / 1 degenerate triangle" purely
	// based on which grid cell the layout put it in (it failed when placed first
	// but not when the D6 came first). It must now read printable in either order.
	for (const order of [
		['d24', 'd6'],
		['d6', 'd24']
	] as const) {
		it(`germania D24 + D6 stay printable (order: ${order.join(', ')})`, () => {
			const legends = loadImmutableLegends(germania as unknown as SerialisedLegendSet);
			const d24 = {
				id: 'd24',
				kind: 'd24_deltoidal_icositetrahedron',
				parameters: { engraving_depth: 0.8, engraving_tolerance: 0.5 },
				face_parameters: []
			};
			const d6 = {
				id: 'd6',
				kind: 'd6_cube',
				parameters: { engraving_depth: 0.8, engraving_tolerance: 0.5 },
				face_parameters: []
			};
			const set = {
				id: 'test',
				name: 'test',
				updated: 0,
				legends,
				dice: order.map((id) => (id === 'd24' ? d24 : d6))
			} as unknown as DiceSet;
			expectAllPrintable(buildExportMeshes(set, { selectedIds: [...order] }));
		});
	}

	// Regression: fonts with dense glyph outlines produce Manifold edges shorter
	// than checkMesh's geometric weld (1e-4 mm). Indexed topology stays printable;
	// welding the expanded float buffer used to false-flag hundreds of "degenerate"
	// triangles (and cascading open edges) on the export page.
	it('alice_in_wonderland d20 stays printable via indexed Manifold check', () => {
		const legends = loadImmutableLegends(alice as unknown as SerialisedLegendSet);
		const set = {
			id: 'test',
			name: 'test',
			updated: 0,
			legends,
			dice: [
				{
					id: 'd20',
					kind: 'd20_icosahedron',
					parameters: { engraving_depth: 0.8, engraving_tolerance: 0.5 },
					face_parameters: []
				}
			]
		} as unknown as DiceSet;
		expectAllPrintable(buildExportMeshes(set, { selectedIds: ['d20'] }));
	});
});
