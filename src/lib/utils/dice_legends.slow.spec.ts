// @vitest-environment jsdom
//
// The "thorough" engraving audit. Lives in the `slow` suite (excluded from the
// default `bun run test`; invoke with `bun run test:slow`). Run it after any
// change to the 3D / engraving pipeline (triangulation, repair, the legend
// fitter, export assembly).
//
// It exercises the engraving of every builtin-font glyph (and the regression
// fixtures, and a worst-case solid square) on every DISTINCT face shape in the
// whole dice catalogue, asserting each engraves to a printable solid.
//
// Speed: rather than rebuilding a whole die per glyph and engraving all its
// faces, it uses the audit rig (engraving_audit.ts) - each physical die shape is
// built once, and a glyph is engraved on just one representative of each
// congruent number-face class, run through the real assemble + repair + check
// pipeline. Congruent faces (within a die and across physically-identical dice
// like a d10 vs a d%) are deduped, so each distinct face shape is checked once.
// A separate real-Builder.export smoke test (engraving.die.slow.spec) guards
// against the rig drifting from the production export path.

import { describe, it, expect } from 'vitest';
import { Shape } from 'three';
import { shapeFromJSON } from './to_json';
import {
	collectAuditTargets,
	auditGlyph,
	type AuditTarget,
	type GlyphAuditFailure
} from './engraving_audit';
import { buildCandidateOnDie } from './validate_legends';
import { checkMesh } from './mesh_check';
import dice from '$lib/dice';
import tektur from '../fonts/generated/tektur.json';
import alice from '../fonts/generated/alice_in_wonderland.json';
import averia from '../fonts/generated/averia.json';
import germania from '../fonts/generated/germania_one.json';
import josefin from '../fonts/generated/josefin_medium.json';
import siamese from '../fonts/generated/siamese_katsong.json';
import voltaire from '../fonts/generated/voltaire.json';
import problemGlyphs from './__fixtures__/problem_glyphs.json';

type SerialisedShape = Parameters<typeof shapeFromJSON>[0];
type FontJson = { shapes: Array<Array<SerialisedShape>> };

const fontSets: Array<[string, FontJson]> = [
	['tektur', tektur as unknown as FontJson],
	['alice_in_wonderland', alice as unknown as FontJson],
	['averia', averia as unknown as FontJson],
	['germania_one', germania as unknown as FontJson],
	['josefin_medium', josefin as unknown as FontJson],
	['siamese_katsong', siamese as unknown as FontJson],
	['voltaire', voltaire as unknown as FontJson]
];

// Optionally scope the audit. `DIE=d4_infinity` checks a single die's faces;
// `FONT=germania_one` checks a single font. Both default to everything. An
// unknown id fails loudly rather than silently checking nothing.
const dieFilter = process.env.DIE?.trim();
const fontFilter = process.env.FONT?.trim();
const allKinds = Object.keys(dice);
if (dieFilter && !allKinds.includes(dieFilter)) {
	throw new Error(`DIE=${dieFilter} is not a known die kind. Known: ${allKinds.join(', ')}`);
}
const dieKinds = dieFilter ? [dieFilter] : allKinds;
const fonts = fontFilter ? fontSets.filter(([name]) => name === fontFilter) : fontSets;
if (fontFilter && fonts.length === 0) {
	throw new Error(`FONT=${fontFilter} is not a known font.`);
}

// Built once: one target per distinct number-face shape across the catalogue.
const targets: Array<AuditTarget> = collectAuditTargets(dieKinds);

// Generous per-font budget: one `it` engraves ~100 glyphs across every distinct
// face shape (each a real engrave + assemble + structural check).
const FONT_TIMEOUT = 300_000;

function describeFailures(label: string, failures: Array<GlyphAuditFailure>): string {
	return (
		`${label} failed on ${failures.length} face(s):\n` +
		failures
			.map(
				(f) =>
					`  ${f.target}: ${f.result.badEdgeCount} open/non-manifold edge(s), ` +
					`${f.result.degenerateTriangleCount} degenerate, ` +
					`${f.result.duplicateTriangleCount} duplicate`
			)
			.join('\n')
	);
}

describe('every builtin font glyph engraves printably on every distinct face shape', () => {
	for (const [fontName, json] of fonts) {
		it(
			fontName,
			async () => {
				const offenders: Array<string> = [];
				let processed = 0;
				for (let slot = 0; slot < json.shapes.length; slot++) {
					const serialised = json.shapes[slot];
					if (!serialised || serialised.length === 0) {
						continue; // font doesn't provide this glyph
					}
					const symbols = serialised.map((s) => shapeFromJSON(s));
					const failures = auditGlyph(symbols, targets);
					if (failures.length > 0) {
						offenders.push(describeFailures(`${fontName} glyph #${slot}`, failures));
					}
					// yield to the event loop periodically so vitest's reporter heartbeat
					// doesn't time out on this long, otherwise-synchronous test.
					if (++processed % 16 === 0) {
						await new Promise((r) => setTimeout(r, 0));
					}
				}
				expect(offenders.join('\n\n'), offenders.join('\n\n')).toBe('');
			},
			FONT_TIMEOUT
		);
	}
});

// A solid, edge-to-edge square is the pathological "biggest possible" glyph: no
// internal detail to give the legend fitter slack. It must always shrink to fit
// (however small/oddly-shaped the face) and still engrave a printable solid -
// guarding findBestLegendScalingFactor against punching through a face edge.
function solidSquare(): Shape {
	const half = 5;
	const square = new Shape();
	square.moveTo(-half, -half);
	square.lineTo(half, -half);
	square.lineTo(half, half);
	square.lineTo(-half, half);
	square.closePath();
	return square;
}

describe('a solid square engraves printably on every distinct face shape', () => {
	it(
		'solid square',
		() => {
			const failures = auditGlyph([solidSquare()], targets);
			expect(
				describeFailures('solid square', failures),
				describeFailures('solid square', failures)
			).toMatch(/^solid square failed on 0 face/);
		},
		FONT_TIMEOUT
	);
});

// Regression fixtures: glyphs that are KNOWN to tear on some face shapes today
// (a libtess sliver that repairDegenerateTriangles drops without fully healing
// the T-junction). These are marked `it.fails` so the suite stays green while
// documenting the open bug: once the repair is fixed, the assertion will pass,
// `it.fails` will start FAILING, and that's the prompt to flip these to plain
// `it`. Add new offenders to __fixtures__/problem_glyphs.json.
// Faithfulness guard: the rig (per-face, isolated) must reach the SAME
// printable verdict as the real, whole-die Builder.export pipeline. We check a
// known-clean glyph and a known-tearing fixture on both a die they pass on and
// one they fail on, asserting the rig's per-face verdict for that die equals
// the real export's whole-die verdict. If the rig ever drifts from production,
// this fails before the (rig-only) coverage above can give false confidence.
describe('audit rig matches real Builder.export verdict', () => {
	const cleanDigit = (tektur as unknown as FontJson).shapes[8]; // "8"
	const tearing = (problemGlyphs as Array<{ shapes: Array<SerialisedShape> }>)[0].shapes; // "1"
	const cases: Array<{ name: string; shapes: Array<SerialisedShape>; die: string }> = [
		{ name: '"8" on d6_cube', shapes: cleanDigit, die: 'd6_cube' },
		{ name: '"8" on d12_tetartoid', shapes: cleanDigit, die: 'd12_tetartoid' },
		{ name: 'fixture "1" on d6_cube', shapes: tearing, die: 'd6_cube' },
		{ name: 'fixture "1" on d12_tetartoid', shapes: tearing, die: 'd12_tetartoid' }
	];
	for (const c of cases) {
		it(
			c.name,
			() => {
				const realPrintable = checkMesh(
					buildCandidateOnDie({ label: c.name, kind: 'legend', shapes: c.shapes }, c.die)
				).isPrintable;
				const symbols = c.shapes.map((s) => shapeFromJSON(s));
				const rigPrintable = auditGlyph(symbols, collectAuditTargets([c.die])).length === 0;
				expect(rigPrintable, `rig=${rigPrintable} real=${realPrintable}`).toBe(realPrintable);
			},
			FONT_TIMEOUT
		);
	}
});

// Regression fixtures: glyphs that once tore on some face shapes (a libtess
// sliver that repairDegenerateTriangles used to drop without fully healing the
// T-junction). They must now engrave printably everywhere. Add new offenders to
// __fixtures__/problem_glyphs.json.
describe('regression: previously-reported problem glyphs engrave printably everywhere', () => {
	for (const fixture of problemGlyphs as Array<{ label: string; shapes: Array<SerialisedShape> }>) {
		it(
			fixture.label,
			() => {
				const symbols = fixture.shapes.map((s) => shapeFromJSON(s));
				const failures = auditGlyph(symbols, targets);
				expect(failures, describeFailures(fixture.label, failures)).toHaveLength(0);
			},
			FONT_TIMEOUT
		);
	}
});
