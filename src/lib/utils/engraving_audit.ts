// A fast, faithful audit of "does this glyph engrave to a printable solid on
// every face shape in the catalogue?".
//
// The naive audit (validate_legends.checkLegendCandidateAllDice) rebuilds a
// whole die from scratch for every (glyph, die) pair and engraves the glyph on
// *every* face. That repeats two kinds of work needlessly:
//
//   1. The die body (model.build) is recomputed for every glyph.
//   2. A d60 engraves the same glyph onto 60 congruent faces, when one
//      representative tells you everything the other 59 would.
//
// This rig removes both. Each physical die shape is built ONCE to discover its
// face shapes and the legend scale it would use; a glyph is then engraved on
// just one representative of each congruent number-face class and the resulting
// engraving is checked in isolation.
//
// Why checking one face in isolation is equivalent to building the whole die:
// an engraving only ever touches its own face (the glyph is inset from the edge
// by the clearance, so it never reaches the shared perimeter), and the mesh
// repair that heals/breaks it is driven purely by that face's own slivers. The
// only edges an isolated face has that a full die wouldn't are the face's outer
// perimeter, where on a real die the neighbouring face closes the seam - those
// are filtered out here. Everything that decides printability (interior glyph
// walls, the engraved back, the cap around the glyph) is bit-for-bit identical
// to the full export, run through the exact same assemble + repair pipeline.
//
// Dice that are the same physical shape (e.g. a d10 and a d% trapezohedron) and
// faces congruent to one already covered are de-duplicated, so each distinct
// face shape is exercised exactly once across the whole catalogue.

import { Shape, Vector2, type BufferGeometry } from 'three';
import dice from '$lib/dice';
import type { DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { DefaultDivisions, engrave } from './engraving';
import { assembleExportSolid, engravingParam, engravingToleranceParam } from './builder';
import { findBestLegendScalingFactor } from './shapes';
import { checkMesh } from './mesh_check';
import { toNonIndexed } from './3d';

// tolerances for recognising a bad edge that sits on the (open) face perimeter,
// which a real die would have closed by its neighbour. The cap's perimeter
// vertices ARE the face outline points lifted to z=0, so these are generous.
const PERIMETER_Z_EPS = 1e-3;
const PERIMETER_XY_EPS = 1e-3;

// Prepare a freshly-engraved geometry the same way export() does before merging:
// non-indexed, with normals, and no stale uv channel (so all parts share one
// attribute layout for mergeGeometries).
function prepare(g: BufferGeometry): BufferGeometry {
	const ng = toNonIndexed(g);
	ng.computeVertexNormals();
	delete ng.attributes.uv;
	return ng;
}

// squared distance from point p to segment a-b in the xy plane.
function segDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	const cx = ax + t * dx;
	const cy = ay + t * dy;
	return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

// A rotation/reflection/translation-invariant signature of a face polygon, so
// congruent faces (within a die or across dice) collapse to one key. Built from
// the cyclic sequence of (edge length, turn angle), canonicalised over all
// rotations and the reflection. Lengths/angles are absolute (rounded), so two
// faces only match when they are the same size and shape - a smaller copy is a
// genuinely different engraving target and is kept distinct.
export function faceCongruenceKey(shape: Shape): string {
	const pts = shape.getPoints();
	if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) {
		pts.pop();
	}
	const n = pts.length;
	if (n < 3) {
		return 'degenerate';
	}
	const r = (x: number) => Math.round(x * 1000) / 1000;
	const tokens: Array<string> = [];
	for (let i = 0; i < n; i++) {
		const prev = pts[(i - 1 + n) % n];
		const cur = pts[i];
		const next = pts[(i + 1) % n];
		const edge = cur.distanceTo(next);
		const ax = cur.x - prev.x;
		const ay = cur.y - prev.y;
		const bx = next.x - cur.x;
		const by = next.y - cur.y;
		const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
		tokens.push(`${r(edge)}@${r(angle)}`);
	}
	const candidates: Array<string> = [];
	const rev = [...tokens].reverse();
	for (const seq of [tokens, rev]) {
		for (let s = 0; s < n; s++) {
			candidates.push(seq.slice(s).concat(seq.slice(0, s)).join(','));
		}
	}
	candidates.sort();
	return candidates[0];
}

// Result of engraving one glyph on one representative face. Counts exclude the
// face's own (legitimately open) perimeter.
export type FaceAuditResult = {
	printable: boolean;
	// boundary + non-manifold edges left after discounting the face perimeter.
	badEdgeCount: number;
	degenerateTriangleCount: number;
	duplicateTriangleCount: number;
};

// One thing to engrave-and-check: a representative number face of some die.
export type AuditTarget = {
	dieKind: string;
	faceIndex: number;
	// `${dieKind}#${faceIndex}` - stable label for test output.
	label: string;
	check(symbols: Array<Shape>): FaceAuditResult;
};

// Per-die state, built once and reused for every glyph.
class DieRig {
	private readonly depth: number;
	private readonly tolerance: number;
	private readonly faces: Array<DieFaceModel>;
	private readonly firstNumberFaceShape: Shape;
	private readonly firstNumberFaceConvex: boolean;
	private readonly individualLegendScaling: boolean;
	// cached outline polygon (z=0 plane) per face index, for perimeter discount.
	private readonly outlines = new Map<number, Array<Vector2>>();

	constructor(
		public readonly dieKind: string,
		model: DieModel
	) {
		this.depth = engravingParam.defaultValue;
		this.tolerance = engravingToleranceParam.defaultValue;
		const built = model.build(
			{ engraving_depth: this.depth, engraving_tolerance: this.tolerance },
			{}
		);
		this.faces = built.faces;
		const numberFace = this.faces.find((f) => f.isNumberFace);
		if (!numberFace) {
			throw new Error(`${dieKind} has no number face`);
		}
		this.firstNumberFaceShape = numberFace.shape;
		this.firstNumberFaceConvex = numberFace.convex !== false;
		this.individualLegendScaling = !!built.sizeLegendsIndividually;
	}

	// the unique congruent classes of number face, as one representative index
	// each. Most dice return a single index (all number faces congruent). `seen`
	// is shared across dice so a face congruent to one already covered elsewhere
	// is skipped catalogue-wide.
	uniqueNumberFaceIndices(seen: Set<string>): Array<number> {
		const out: Array<number> = [];
		for (let i = 0; i < this.faces.length; i++) {
			const face = this.faces[i];
			if (!face.isNumberFace) {
				continue;
			}
			const key = faceCongruenceKey(face.shape);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			out.push(i);
		}
		return out;
	}

	private outlineFor(faceIndex: number): Array<Vector2> {
		let outline = this.outlines.get(faceIndex);
		if (!outline) {
			outline = this.faces[faceIndex].shape.getPoints(DefaultDivisions);
			if (outline.length > 1 && outline[0].distanceTo(outline[outline.length - 1]) < 1e-9) {
				outline = outline.slice(0, -1);
			}
			this.outlines.set(faceIndex, outline);
		}
		return outline;
	}

	private onPerimeter(x: number, y: number, z: number, outline: Array<Vector2>): boolean {
		if (Math.abs(z) > PERIMETER_Z_EPS) {
			return false;
		}
		const eps2 = PERIMETER_XY_EPS * PERIMETER_XY_EPS;
		for (let i = 0; i < outline.length; i++) {
			const a = outline[i];
			const b = outline[(i + 1) % outline.length];
			if (segDistSq(x, y, a.x, a.y, b.x, b.y) <= eps2) {
				return true;
			}
		}
		return false;
	}

	check(faceIndex: number, symbols: Array<Shape>): FaceAuditResult {
		const face = this.faces[faceIndex];
		// mirror the builder's legend scaling exactly (recalculateLegendScaling +
		// getDefaultScaleForLegend). The fit is measured against the FIRST number
		// face. With per-die individual scaling the glyph is engraved at that fit;
		// otherwise the builder uses `currentSmallestLegendScaling`, which starts at
		// 1 and only drops for a glyph too big to fit - i.e. it NEVER enlarges a
		// glyph past its natural size. Using the raw fit here would engrave a far
		// larger glyph than reality and flag bugs that never occur.
		const fit = findBestLegendScalingFactor(
			this.firstNumberFaceShape,
			symbols,
			this.tolerance,
			this.firstNumberFaceConvex
		);
		const scale = this.individualLegendScaling ? fit : Math.min(1, fit);

		const parts = engrave(
			face.shape,
			symbols,
			{ scale },
			this.depth,
			this.tolerance,
			DefaultDivisions,
			face.convex !== false
		).map(prepare);
		const solid = assembleExportSolid(parts);
		const report = checkMesh(solid.getAttribute('position').array, { collectBad: true });

		// discount the face's own perimeter (open on an isolated face; closed by
		// the neighbour on a real die). Non-manifold edges never lie on the
		// perimeter (it's a one-sided boundary), so any survivor is a real defect.
		const outline = this.outlineFor(faceIndex);
		const be = report.badEdgePositions ?? new Float32Array(0);
		let badEdgeCount = 0;
		for (let k = 0; k < be.length; k += 6) {
			const aOnPerim = this.onPerimeter(be[k], be[k + 1], be[k + 2], outline);
			const bOnPerim = this.onPerimeter(be[k + 3], be[k + 4], be[k + 5], outline);
			if (!(aOnPerim && bOnPerim)) {
				badEdgeCount++;
			}
		}

		return {
			printable:
				badEdgeCount === 0 &&
				report.degenerateTriangleCount === 0 &&
				report.duplicateTriangleCount === 0,
			badEdgeCount,
			degenerateTriangleCount: report.degenerateTriangleCount,
			duplicateTriangleCount: report.duplicateTriangleCount
		};
	}
}

// Build the de-duplicated list of audit targets across the catalogue: one per
// distinct number-face shape. `kinds` restricts the catalogue (e.g. a single die
// for a focused run); defaults to every die.
export function collectAuditTargets(
	kinds: ReadonlyArray<string> = Object.keys(dice)
): Array<AuditTarget> {
	const targets: Array<AuditTarget> = [];
	const seenFaceKeys = new Set<string>();
	for (const dieKind of kinds) {
		const model = (dice as Record<string, DieModel>)[dieKind];
		if (!model) {
			throw new Error(`unknown die kind: ${dieKind}`);
		}
		let rig: DieRig;
		try {
			rig = new DieRig(dieKind, model);
		} catch {
			continue; // no number faces: nothing to engrave on this die
		}
		for (const faceIndex of rig.uniqueNumberFaceIndices(seenFaceKeys)) {
			targets.push({
				dieKind,
				faceIndex,
				label: `${dieKind}#${faceIndex}`,
				check: (symbols) => rig.check(faceIndex, symbols)
			});
		}
	}
	return targets;
}

export type GlyphAuditFailure = {
	target: string;
	result: FaceAuditResult;
};

// Audit a single glyph across all (unique) targets and return the ones whose
// engraving isn't printable. Shapes are used as-is (the builder assumes legend
// shapes are already centred, as the font generator / legend editor store them).
export function auditGlyph(
	symbols: Array<Shape>,
	targets: Array<AuditTarget> = collectAuditTargets()
): Array<GlyphAuditFailure> {
	const failures: Array<GlyphAuditFailure> = [];
	for (const target of targets) {
		const result = target.check(symbols.map((s) => s.clone()));
		if (!result.printable) {
			failures.push({ target: target.label, result });
		}
	}
	return failures;
}
