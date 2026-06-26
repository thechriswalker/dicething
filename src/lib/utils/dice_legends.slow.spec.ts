// @vitest-environment jsdom
//
// The "thorough" 3D audit. Lives in the `slow` suite (excluded from the default
// `bun run test`; invoke with `bun run test:slow`) because it builds the real
// export solid for the whole dice catalogue and is far too heavy for every
// save. Run it after any change to the 3D / engraving pipeline.
//
// Two layers of coverage:
//
//  1. "default legends" - every builtin font is built onto every die model with
//     that die's natural legends (so the d% gets its slanted two-digit "tens",
//     the d60 gets 1-60, the coin gets the logo, etc). This is what catches
//     composite-glyph-on-its-native-face regressions like the germania "40"
//     sliver on the trapezohedron, which the single-character d6 smoke test
//     (engraving.die.slow.spec) can't see.
//
//  2. "shared audit" - exercises checkLegendCandidateAllDice, the exact routine
//     the legendset editor page runs to validate a custom set: a single glyph
//     engraved onto every number face of every die, run through the structural
//     check. This guards the shared code path (and the composite glyph) across
//     the whole catalogue.

import { describe, it, expect } from 'vitest';
import { Shape } from 'three';
import dice from '$lib/dice';
import { Builder } from './builder';
import { checkMesh, type MeshCheckReport } from './mesh_check';
import { Legend, loadImmutableLegends, type SerialisedLegendSet } from './legends';
import { shapeToJSON } from './to_json';
import {
	buildCandidateOnDie,
	checkLegendCandidateAllDice,
	type LegendCandidate
} from './validate_legends';
import tektur from '../fonts/generated/tektur.json';
import alice from '../fonts/generated/alice_in_wonderland.json';
import averia from '../fonts/generated/averia.json';
import germania from '../fonts/generated/germania_one.json';
import josefin from '../fonts/generated/josefin_medium.json';
import siamese from '../fonts/generated/siamese_katsong.json';
import voltaire from '../fonts/generated/voltaire.json';

const fontSets: Array<[string, SerialisedLegendSet]> = [
	['tektur', tektur as unknown as SerialisedLegendSet],
	['alice_in_wonderland', alice as unknown as SerialisedLegendSet],
	['averia', averia as unknown as SerialisedLegendSet],
	['germania_one', germania as unknown as SerialisedLegendSet],
	['josefin_medium', josefin as unknown as SerialisedLegendSet],
	['siamese_katsong', siamese as unknown as SerialisedLegendSet],
	['voltaire', voltaire as unknown as SerialisedLegendSet]
];

// Optionally scope the whole audit to a single die so a new/changed shape can be
// exhaustively checked on its own without rebuilding the entire catalogue:
//
//   DIE=d4_infinity bun run test:slow
//
// Unset (the CI default) runs every die. An unknown id fails loudly rather than
// silently checking nothing.
const dieFilter = process.env.DIE?.trim();
const allKinds = Object.keys(dice) as Array<keyof typeof dice>;
if (dieFilter && !allKinds.includes(dieFilter as keyof typeof dice)) {
	throw new Error(
		`DIE=${dieFilter} is not a known die kind. Known: ${allKinds.join(', ')}`
	);
}
const dieKinds = dieFilter ? allKinds.filter((k) => k === dieFilter) : allKinds;

// d60s + the coin (SVGLoader) are the slow builds; 30s leaves comfortable room.
const SLOW_TIMEOUT = 30_000;

function expectPrintable(report: MeshCheckReport, where: string) {
	expect(report.degenerateTriangleCount, `${where}: degenerate triangles`).toBe(0);
	expect(report.nonManifoldEdgeCount, `${where}: non-manifold edges`).toBe(0);
	expect(report.boundaryEdgeCount, `${where}: open/boundary edges`).toBe(0);
	expect(report.duplicateTriangleCount, `${where}: duplicate triangles`).toBe(0);
}

// Layer 1: every font on every die, using each die's default legends.
describe('every builtin font prints on every die (default legends)', () => {
	for (const [fontName, json] of fontSets) {
		for (const dieKind of dieKinds) {
			it(
				`${fontName} on ${dieKind}`,
				() => {
					const legends = loadImmutableLegends(json);
					const builder = new Builder(dice[dieKind], legends);
					const mesh = builder.export({}, []);
					const report = checkMesh(mesh.geometry.getAttribute('position').array);
					expectPrintable(report, `${fontName}/${dieKind}`);
				},
				SLOW_TIMEOUT
			);
		}
	}
});

// Layer 2: the shared page audit (one glyph -> every die). Engraves a glyph onto
// every number face of every die, mirroring what the legendset editor runs when
// a user clicks "check". We include the wide composite "tens" (40, 00) and the
// maker logo as well as plain digits: these forced wide-glyph-on-narrow-face
// combinations (e.g. on the d3_odd_prism) are exactly what used to trip the
// legend fitter, so they double as a regression for findBestLegendScalingFactor.
const auditGlyphs: Array<[string, Legend]> = [
	['0', Legend.ZERO],
	['4', Legend.FOUR],
	['8', Legend.EIGHT],
	['40 (tens)', Legend.FORTY],
	['00 (tens)', Legend.DOUBLE_ZERO],
	['logo', Legend.MAKER_LOGO]
];

describe('shared all-dice audit prints every glyph on every die', () => {
	for (const [fontName, json] of fontSets) {
		const legends = loadImmutableLegends(json);
		for (const [label, legend] of auditGlyphs) {
			const shapes = legends.get(legend).map((s) => shapeToJSON(s));
			if (shapes.length === 0) {
				continue; // font doesn't provide this glyph (e.g. no logo): nothing to check
			}
			const candidate: LegendCandidate = { label, kind: 'character', shapes };
			it(
				`${fontName} "${label}"`,
				async () => {
					const results = await checkLegendCandidateAllDice(
						candidate,
						async (positions) => checkMesh(positions),
						undefined,
						dieKinds
					);
					for (const r of results) {
						const where = `${fontName} "${label}" on ${r.dieKind}`;
						expect(r.error, `${where}: build error`).toBeUndefined();
						if (r.report) {
							expectPrintable(r.report, where);
						}
					}
				},
				SLOW_TIMEOUT
			);
		}
	}
});

// A solid, edge-to-edge square is the pathological "biggest possible" glyph: it
// has no internal detail to give the fitter slack, so it stresses the legend
// scaling on every face shape. The fitter must always shrink it enough to fit
// (however small the face), and the engraving must stay a printable solid. This
// guards findBestLegendScalingFactor: a square that overflows a face would punch
// through the edge and tear the mesh open.
function solidSquareCandidate(): LegendCandidate {
	const half = 5;
	const square = new Shape();
	square.moveTo(-half, -half);
	square.lineTo(half, -half);
	square.lineTo(half, half);
	square.lineTo(-half, half);
	square.closePath();
	return { label: '■ solid square', kind: 'character', shapes: [shapeToJSON(square)] };
}

describe('a solid square fits and prints on every die', () => {
	for (const dieKind of dieKinds) {
		it(
			`square on ${dieKind}`,
			() => {
				const positions = buildCandidateOnDie(solidSquareCandidate(), dieKind);
				const report = checkMesh(positions);
				expectPrintable(report, `square/${dieKind}`);
			},
			SLOW_TIMEOUT
		);
	}
});
