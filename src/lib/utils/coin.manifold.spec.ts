import { describe, it, expect } from 'vitest';
import dice from '$lib/dice';
import { Builder } from './builder';
import { checkMesh } from './mesh_check';
import { Legend, loadImmutableLegends, type SerialisedLegendSet } from './legends';
import germania from '../fonts/generated/germania_one.json';

// The coin D2 is the only die that can take an arbitrary (and concave) custom
// SVG outline for its faces. That outline arrives heavily over-sampled along its
// curves, and any near-collinear points left in it get silently dropped by the
// face-cap triangulator while the rim walls still use them as corners -- a
// T-junction that opens the exported solid. Regression for "coin D2 (default
// path) blank => 4 open edges / 8 bad edges". The default custom path is the
// concave dicething logo; we also cover the regular-polygon mode.

function expectPrintable(geo: import('three').BufferGeometry, what: string) {
	const r = checkMesh(geo.getAttribute('position').array as ArrayLike<number>);
	expect(r.boundaryEdgeCount, `${what} open/boundary edges`).toBe(0);
	expect(r.nonManifoldEdgeCount, `${what} non-manifold edges`).toBe(0);
	expect(r.degenerateTriangleCount, `${what} degenerate triangles`).toBe(0);
	expect(r.isPrintable, `${what} printable`).toBe(true);
}

const legends = loadImmutableLegends(germania as unknown as SerialisedLegendSet);

function buildCoin(
	params: Record<string, number>,
	blank: boolean,
	stringParams: Record<string, string> = {}
) {
	const builder = new Builder(dice.d2_coin, legends);
	builder.build(params, [], { explode: false }, stringParams);
	const faceParams = blank ? builder.getFaces().map(() => ({ legend: Legend.BLANK })) : [];
	return builder.export(params, faceParams, stringParams).geometry;
}

// a deeply concave 4-pointed star (alternating outer/inner radius) as a custom
// outline, to exercise the general concave containment + engraving path beyond
// the gentler logo outline.
const starPath =
	'M 0 -100 L 28.28 -28.28 L 100 0 L 28.28 28.28 L 0 100 ' +
	'L -28.28 28.28 L -100 0 L -28.28 -28.28 Z';

describe('coin D2 exports a printable solid', () => {
	// custom mode = the default concave logo path.
	for (const blank of [true, false]) {
		it(`custom logo path (${blank ? 'blank' : 'engraved'})`, () => {
			expectPrintable(buildCoin({}, blank), `coin custom ${blank ? 'blank' : 'engraved'}`);
		});
	}

	for (const diameter of [8, 24, 60]) {
		it(`custom logo path blank @ diameter ${diameter}`, () => {
			expectPrintable(
				buildCoin({ coin_diameter: diameter }, true),
				`coin custom blank d=${diameter}`
			);
		});
	}

	// a strongly concave custom outline (4-pointed star).
	for (const blank of [true, false]) {
		it(`concave star path (${blank ? 'blank' : 'engraved'})`, () => {
			expectPrintable(
				buildCoin({ coin_shape_mode: 1 }, blank, { coin_path: starPath }),
				`coin star ${blank ? 'blank' : 'engraved'}`
			);
		});
	}

	// regular-polygon mode for comparison / coverage.
	for (const segments of [3, 7, 24]) {
		it(`polygon ${segments}-gon blank`, () => {
			expectPrintable(
				buildCoin({ coin_shape_mode: 0, coin_segments: segments }, true),
				`coin ${segments}-gon blank`
			);
		});
	}
});
