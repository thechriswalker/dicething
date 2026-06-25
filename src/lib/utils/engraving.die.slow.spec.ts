import { describe, it, expect } from 'vitest';
import dice from '$lib/dice';
import { Builder } from './builder';
import { checkMesh } from './mesh_check';
import { Legend, loadImmutableLegends, type SerialisedLegendSet } from './legends';
import tektur from '../fonts/generated/tektur.json';
import alice from '../fonts/generated/alice_in_wonderland.json';
import averia from '../fonts/generated/averia.json';
import germania from '../fonts/generated/germania_one.json';
import josefin from '../fonts/generated/josefin_medium.json';
import siamese from '../fonts/generated/siamese_katsong.json';
import voltaire from '../fonts/generated/voltaire.json';

// Rather than engrave every legend of every font onto an abstract square (the
// old engraving.manifold.spec), this exercises the *real* export pipeline: it
// builds an actual d6 (the simplest die) with a single legend on every face and
// runs the full structural check (Builder.export -> mergeVertices ->
// removeDuplicateTriangles -> checkMesh) on the resulting solid.
//
// Every builtin number is composed from the same atomic glyphs - the digits
// 0-9, the disambiguating dot (in the marked 6./9.), and the maker logo - so
// checking those eleven-ish glyphs covers what the fonts actually engrave
// without building thousands of meshes.

const fontSets: Array<[string, SerialisedLegendSet]> = [
	['tektur', tektur as unknown as SerialisedLegendSet],
	['alice_in_wonderland', alice as unknown as SerialisedLegendSet],
	['averia', averia as unknown as SerialisedLegendSet],
	['germania_one', germania as unknown as SerialisedLegendSet],
	['josefin_medium', josefin as unknown as SerialisedLegendSet],
	['siamese_katsong', siamese as unknown as SerialisedLegendSet],
	['voltaire', voltaire as unknown as SerialisedLegendSet]
];

// the atomic glyphs every builtin number is built from, plus the logo.
const testLegends: Array<[string, Legend]> = [
	['0', Legend.ZERO],
	['1', Legend.ONE],
	['2', Legend.TWO],
	['3', Legend.THREE],
	['4', Legend.FOUR],
	['5', Legend.FIVE],
	['6', Legend.SIX],
	['7', Legend.SEVEN],
	['8', Legend.EIGHT],
	['9', Legend.NINE],
	['6. (dot)', Legend.SIX_MARKED],
	['9. (dot)', Legend.NINE_MARKED],
	['logo', Legend.MAKER_LOGO]
];

// Build a d6 with the given legend engraved on every face and return its
// structural report. Empty glyphs (a font missing the logo, say) engrave blank
// and trivially pass.
function exportD6(legends: ReturnType<typeof loadImmutableLegends>, legend: Legend) {
	const builder = new Builder(dice.d6_cube, legends);
	const faceParams = Array.from({ length: 6 }, () => ({ legend }));
	const mesh = builder.export({}, faceParams);
	return checkMesh(mesh.geometry.getAttribute('position').array);
}

describe('builtin fonts engrave a printable d6', () => {
	for (const [fontName, json] of fontSets) {
		const legends = loadImmutableLegends(json);
		for (const [label, legend] of testLegends) {
			it(`${fontName} "${label}"`, () => {
				const report = exportD6(legends, legend);
				expect(report.degenerateTriangleCount, 'degenerate triangles').toBe(0);
				expect(report.nonManifoldEdgeCount, 'non-manifold edges').toBe(0);
				expect(report.boundaryEdgeCount, 'open/boundary edges').toBe(0);
			});
		}
	}
});

// The percentile die ("d%") engraves the two-digit "tens" glyphs (00, 10, 20 ..
// 90) onto a fairly small, slanted trapezohedron kite. A long glyph segment can
// make the cap triangulator emit a pencil-thin (long but sub-tolerance-tall)
// collinear triangle whose absolute area still clears a fixed epsilon, so it
// survived degenerate-repair and left the solid non-manifold. Regression: build
// the whole d% (every tens glyph) on every font and require a clean solid.
describe('builtin fonts engrave a printable d% (trapezohedron tens)', () => {
	for (const [fontName, json] of fontSets) {
		it(`${fontName}`, () => {
			const legends = loadImmutableLegends(json);
			const builder = new Builder(dice.d00_trapezohedron, legends);
			const mesh = builder.export({}, []);
			const report = checkMesh(mesh.geometry.getAttribute('position').array);
			expect(report.degenerateTriangleCount, 'degenerate triangles').toBe(0);
			expect(report.nonManifoldEdgeCount, 'non-manifold edges').toBe(0);
			expect(report.boundaryEdgeCount, 'open/boundary edges').toBe(0);
		});
	}
});
