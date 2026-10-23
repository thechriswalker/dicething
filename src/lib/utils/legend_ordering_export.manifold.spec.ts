import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import dice from '$lib/dice';
import fonts from '$lib/fonts';
import { Builder } from './builder';
import { PERCENTILE_ORDERING, STANDARD_ORDERING } from './legend_orderings';

// Order-independent signature of a mesh. Export must engrave the ordering's
// glyphs, not a fresh model.build()'s standard numbering.
function meshSignature(geo: BufferGeometry): string {
	const pos = geo.getAttribute('position');
	const index = geo.index;
	const triCount = (index ? index.count : pos.count) / 3;
	const tris: Array<string> = [];
	const q = (n: number) => Math.round(n * 1e3);
	for (let t = 0; t < triCount; t++) {
		const verts: Array<string> = [];
		for (let k = 0; k < 3; k++) {
			const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
			verts.push(`${q(pos.getX(vi))},${q(pos.getY(vi))},${q(pos.getZ(vi))}`);
		}
		verts.sort();
		tris.push(verts.join('|'));
	}
	tris.sort();
	let h = 2166136261;
	for (const tri of tris) {
		for (let i = 0; i < tri.length; i++) {
			h ^= tri.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
	}
	return `${tris.length}:${h >>> 0}`;
}

function exportSignature(
	model: (typeof dice)[keyof typeof dice],
	legends: Awaited<ReturnType<(typeof fonts)['voltaire']['load']>>,
	ordering: string
): string {
	const builder = new Builder(model, legends);
	const mesh = builder.export({}, [], {}, ordering);
	const signature = meshSignature(mesh.geometry);
	mesh.geometry.dispose();
	builder.takeExportManifold()?.delete();
	return signature;
}

describe('export engraves the chosen legend ordering', () => {
	it('engraves percentile glyphs for a d10 with Standard Percentile ordering', async () => {
		const legends = await fonts.voltaire.load();
		// d00_trapezohedron bakes 00–90 into its build(); a stored d% is the same
		// solid as d10_trapezohedron plus legend_ordering 'percentile'.
		const percentile = exportSignature(dice.d10_trapezohedron, legends, PERCENTILE_ORDERING);
		const bakedTens = exportSignature(dice.d00_trapezohedron, legends, STANDARD_ORDERING);
		const units = exportSignature(dice.d10_trapezohedron, legends, STANDARD_ORDERING);

		expect(percentile).toBe(bakedTens);
		expect(percentile).not.toBe(units);
	});

	it('engraves a spindown arrangement rather than the standard one', async () => {
		const legends = await fonts.voltaire.load();
		const spindown = exportSignature(dice.d6_cube, legends, 'spindown');
		const standard = exportSignature(dice.d6_cube, legends, STANDARD_ORDERING);
		expect(spindown).not.toBe(standard);
	});
});
