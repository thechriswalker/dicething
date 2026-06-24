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
import { shapeToJSON } from './to_json';
import { shapesFromFontText } from './create_legends';

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
	report?: MeshCheckReport;
	// set when engraving threw outright (a hard failure, not just a bad mesh).
	error?: string;
};

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
export async function checkLegendCandidate(
	candidate: LegendCandidate
): Promise<LegendCheckResult> {
	try {
		const shapes = Array.from({ length: 10 }, () => candidate.shapes);
		const names = shapes.map(() => candidate.label);
		const tempSet = loadImmutableLegends({ id: 'validate', name: 'validate', names, shapes });
		const builder = new Builder(dice.cube_d6, tempSet);
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

// True when a result represents something that won't print cleanly.
export function isBrokenResult(r: LegendCheckResult): boolean {
	return !!r.error || (!!r.report && !r.report.isPrintable);
}

// re-exported for callers that want the slot index alongside (unused here but
// keeps the Legend type handy for UI typing).
export type { Legend };
