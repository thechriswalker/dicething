// Validate that the legends in a (custom) set actually engrave to a printable
// mesh, mirroring the d6 engraving test but driven by the set's own glyphs.
//
// Font-based legends are reduced to their component characters (every builtin
// number is built from the digits 0-9 and the dot, so we only need to check
// those once), while SVG / copied / ad-hoc legends are checked as-is. Each
// candidate is engraved on every face of a d6 and run through the same export
// pipeline + structural check the real export uses, so anything that still
// comes out non-manifold / non-watertight / degenerate (i.e. a genuinely
// pathological glyph the T-junction repair can't save) is reported.

import dice from '$lib/dice';
import { Builder } from './builder';
import { checkMeshInWorker } from './mesh_check_client';
import type { MeshCheckReport } from './mesh_check';
import { type Legend, loadImmutableLegends, type MutableLegendSet } from './legends';
import { shapeFromJSON, shapeToJSON } from './to_json';
import { shapesFromFontText } from './create_legends';
import { collectAuditTargets, type AuditTarget, type FaceAuditResult } from './engraving_audit';

// one thing to check: a label (the character or legend name) and the serialized
// shapes to engrave.
export type LegendCandidate = {
	label: string;
	// kind only affects how we describe it in the UI.
	kind: 'character' | 'legend';
	shapes: Array<unknown>;
};

export type LegendCheckResult = {
	label: string;
	kind: 'character' | 'legend';
	// which die model this candidate was engraved on (the audit checks every
	// die, not just a d6). Omitted by the legacy d6-only helper.
	dieKind?: string;
	dieName?: string;
	report?: MeshCheckReport;
	// set when engraving threw outright (a hard failure, not just a bad mesh).
	error?: string;
};

// a checker that turns a flat position buffer into a structural report. The
// page passes the Web Worker variant; tests pass the synchronous checkMesh.
export type MeshChecker = (positions: ArrayLike<number>) => Promise<MeshCheckReport>;

// Collect the minimal set of things to check from a legend set: the unique
// component characters of every font-based legend (rendered fresh from the
// font), plus every non-font legend's shapes as-is. Duplicate characters are
// only checked once.
export function gatherLegendCandidates(
	set: MutableLegendSet,
	fontBuffer?: ArrayBuffer
): Array<LegendCandidate> {
	const out: Array<LegendCandidate> = [];
	const seenChars = new Set<string>();
	for (const l of set) {
		const shapes = set.get(l);
		if (shapes.length === 0) {
			continue; // blank slot
		}
		const src = set.getSource(l);
		if (src?.kind === 'font' && fontBuffer) {
			for (const ch of [...src.text]) {
				if (ch.trim() === '' || seenChars.has(ch)) {
					continue;
				}
				seenChars.add(ch);
				try {
					const charShapes = shapesFromFontText(fontBuffer, ch);
					if (charShapes.length > 0) {
						out.push({ label: ch, kind: 'character', shapes: charShapes });
					}
				} catch {
					// a character the font can't render: nothing to engrave, skip it.
				}
			}
		} else {
			// svg import, glyph copied from another set, ad-hoc font, or a font
			// legend with no font buffer available: check the stored shapes directly.
			out.push({
				label: set.getLegendName(l),
				kind: 'legend',
				shapes: shapes.map(shapeToJSON)
			});
		}
	}
	return out;
}

// Engrave a single candidate on every face of a d6 and structurally check the
// exported solid. The glyph is placed in the slots the d6 defaults to so the
// builder's legend-fitting scales it onto the face exactly as it would in a
// real export.
export async function checkLegendCandidate(candidate: LegendCandidate): Promise<LegendCheckResult> {
	try {
		const shapes = Array.from({ length: 10 }, () => candidate.shapes);
		const names = shapes.map(() => candidate.label);
		const tempSet = loadImmutableLegends({ id: 'validate', name: 'validate', names, shapes });
		const builder = new Builder(dice.d6_cube, tempSet);
		// default face params => each face engraves its default legend, which we've
		// filled with the candidate glyph.
		const mesh = builder.export({}, []);
		const positions = mesh.geometry.getAttribute('position').array;
		const report = await checkMeshInWorker(positions);
		return { label: candidate.label, kind: candidate.kind, report };
	} catch (e) {
		return {
			label: candidate.label,
			kind: candidate.kind,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}

// Every die model the thorough audit engraves a candidate onto.
export const auditDiceKinds: ReadonlyArray<string> = Object.keys(dice);

// How many legend slots to pre-fill with the candidate glyph. Building a die
// with default face params makes each face pull its canonical legend, so to
// guarantee the candidate lands on every number face we fill every slot any
// builtin die can default to: the canonical 0-30, the maker logo at 31, and the
// remaining numbers packed into 32-103. 110 covers all of them with headroom.
const AUDIT_SLOT_COUNT = 110;

// A legend set whose every slot is the candidate glyph. Building any die with
// default face params then engraves the candidate on each of its number faces,
// while non-number faces (rims, hidden facets) default to blank as usual.
function candidateLegendSet(candidate: LegendCandidate) {
	const shapes = Array.from({ length: AUDIT_SLOT_COUNT }, () => candidate.shapes);
	const names = Array.from({ length: AUDIT_SLOT_COUNT }, () => candidate.label);
	return loadImmutableLegends({ id: 'validate', name: 'validate', names, shapes });
}

// Build the exported solid for `candidate` engraved across `dieKind`'s number
// faces and return its flat, non-indexed position buffer (triangle soup), ready
// for checkMesh / the mesh-check worker.
export function buildCandidateOnDie(
	candidate: LegendCandidate,
	dieKind: string
): ArrayLike<number> {
	const model = (dice as Record<string, (typeof dice)[keyof typeof dice]>)[dieKind];
	if (!model) {
		throw new Error(`unknown die kind: ${dieKind}`);
	}
	const builder = new Builder(model, candidateLegendSet(candidate));
	const mesh = builder.export({}, []);
	return mesh.geometry.getAttribute('position').array;
}

// Engrave a single candidate on every die model and structurally check each
// resulting solid. This is the thorough check the legendset page runs and the
// "slow" suite reuses: a glyph that prints fine on a d6 can still produce a
// non-manifold sliver on, say, a trapezohedron's slanted kite, so every unique
// face shape across the die catalogue gets exercised.
//
// `check` performs the structural test (worker on the page, synchronous in
// tests). `onResult` is invoked after each die so callers can drive progress.
// `kinds` restricts the audit to a subset of die models (defaults to the whole
// catalogue); the slow suite uses it to scope a run to a single die.
export async function checkLegendCandidateAllDice(
	candidate: LegendCandidate,
	check: MeshChecker,
	onResult?: (r: LegendCheckResult) => void,
	kinds: ReadonlyArray<string> = auditDiceKinds
): Promise<Array<LegendCheckResult>> {
	const out: Array<LegendCheckResult> = [];
	for (const dieKind of kinds) {
		// yield a macrotask between dice so the caller's event loop keeps turning:
		// the page stays responsive (each die build is heavy synchronous work) and
		// test runners can deliver their progress heartbeat between builds.
		await new Promise((resolve) => setTimeout(resolve));
		const dieName = (dice as Record<string, (typeof dice)[keyof typeof dice]>)[dieKind]?.name;
		let result: LegendCheckResult;
		try {
			const positions = buildCandidateOnDie(candidate, dieKind);
			const report = await check(positions);
			result = { label: candidate.label, kind: candidate.kind, dieKind, dieName, report };
		} catch (e) {
			result = {
				label: candidate.label,
				kind: candidate.kind,
				dieKind,
				dieName,
				error: e instanceof Error ? e.message : String(e)
			};
		}
		out.push(result);
		onResult?.(result);
	}
	return out;
}

// True when a result represents something that won't print cleanly.
export function isBrokenResult(r: LegendCheckResult): boolean {
	return !!r.error || (!!r.report && !r.report.isPrintable);
}

// ---------------------------------------------------------------------------
// Rig-backed audit (what the legend editor's "check for print problems" runs).
//
// checkLegendCandidateAllDice above rebuilds a whole die per (glyph, die) pair
// and engraves on every face. The audit rig (engraving_audit.ts) instead builds
// each physical die shape ONCE and engraves a glyph on a single representative
// of each congruent number-face class - exercising every distinct face shape in
// the catalogue exactly once, far faster, through the exact same assemble +
// repair pipeline the real export uses. This is the path the editor now uses.

// One distinct face shape a glyph failed to engrave cleanly on, named for the
// representative die that owns it.
export type LegendAuditFailure = {
	dieKind: string;
	dieName: string;
} & FaceAuditResult;

// Per-glyph audit verdict: an empty `failures` list means it prints cleanly on
// every distinct face shape.
export type LegendAuditResult = {
	label: string;
	kind: 'character' | 'legend';
	failures: Array<LegendAuditFailure>;
};

function dieNameFor(dieKind: string): string {
	return (dice as Record<string, (typeof dice)[keyof typeof dice]>)[dieKind]?.name ?? dieKind;
}

// Audit every candidate against every distinct face shape in the catalogue.
// `onProgress(done, total)` is called as targets are processed (total =
// candidates x distinct faces) so the caller can drive a progress bar; the loop
// yields a macrotask periodically so the page stays responsive.
export async function auditLegendCandidates(
	candidates: Array<LegendCandidate>,
	onProgress?: (done: number, total: number) => void,
	targets: Array<AuditTarget> = collectAuditTargets()
): Promise<Array<LegendAuditResult>> {
	const total = candidates.length * targets.length;
	let done = 0;
	const out: Array<LegendAuditResult> = [];
	for (const candidate of candidates) {
		const symbols = candidate.shapes.map((s) => shapeFromJSON(s));
		const failures: Array<LegendAuditFailure> = [];
		for (const target of targets) {
			const result = target.check(symbols.map((s) => s.clone()));
			if (!result.printable) {
				failures.push({ dieKind: target.dieKind, dieName: dieNameFor(target.dieKind), ...result });
			}
			done += 1;
			// yield occasionally: keep the UI thread responsive and let the
			// progress callback paint between bursts of synchronous checks.
			if (done % 8 === 0) {
				onProgress?.(done, total);
				await new Promise((resolve) => setTimeout(resolve));
			}
		}
		out.push({ label: candidate.label, kind: candidate.kind, failures });
	}
	onProgress?.(total, total);
	return out;
}

// re-exported for callers that want the slot index alongside (unused here but
// keeps the Legend type handy for UI typing).
export type { Legend };
