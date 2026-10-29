import { m } from '$lib/paraglide/messages';
import type { DieFaceModel } from '$lib/interfaces/dice';
import type { Dice } from '$lib/interfaces/storage.svelte';
import type { Mesh } from 'three';
import {
	assembleBlankExportShellGeometry,
	buildBlankManifoldExport,
	transformToMat4
} from '../die_manifold';
import type { Manifold } from '../manifold';
import { engravingParam } from '../builder';
import { computePointDownPrintingTransform } from '../printing';
import type { Transform } from '../3d';
import {
	controlValue,
	type ExtraBuildContext,
	type ExtraBuildOption,
	type OptionValues
} from './types';

// A "blank": the same die shape with every face engraving removed (smooth
// faces), either:
//  - smaller (the normal case): inset by "max engraving depth + tolerance" so a
//    cast/painted blank fits inside the engraved master, or
//  - bigger (for making smooth dice): the die size outset by a fixed amount.
//
// Both paths resize via `model.blankParameters` + a rebuild so edges stay sharp.
// (A Minkowski sphere outset would fillet every convex edge.)
const controls: ExtraBuildOption['controls'] = [
	{
		id: 'bigger',
		kind: 'bool',
		label: m.export_opt_blanks_bigger_label,
		default: false,
		help: m.export_opt_blanks_bigger_help
	},
	{
		id: 'tolerance',
		kind: 'number',
		label: m.export_opt_blanks_tolerance_label,
		min: 0,
		max: 10,
		step: 0.05,
		default: 0.2,
		unit: m.export_unit_mm,
		help: m.export_opt_blanks_tolerance_help,
		visibleWhen: { control: 'bigger', equals: false }
	},
	{
		id: 'outset',
		kind: 'number',
		label: m.export_opt_blanks_outset_label,
		min: 0.1,
		max: 10,
		step: 0.05,
		default: 1,
		unit: m.export_unit_mm,
		help: m.export_opt_blanks_outset_help,
		visibleWhen: { control: 'bigger', equals: true }
	}
];

export const blanksOption: ExtraBuildOption = {
	id: 'blanks',
	label: m.export_opt_blanks_label,
	description: m.export_opt_blanks_description,
	defaultEnabled: false,
	controls,
	generate(ctx) {
		const blank = buildPrintBlank(
			ctx.model,
			ctx.builder.getLastDieParams(),
			ctx.builder.getLastStringParams(),
			blankOffsetMm(ctx.die, ctx.values)
		);
		return [{ suffix: 'blank', mesh: blank.previewMesh, manifold: blank.manifold }];
	}
};

/** Print-space resized blank: faces, pose, and the solid those faces describe. */
export type PrintBlank = {
	faces: Array<DieFaceModel>;
	printingTransform: Transform;
	/** Caller owns this. Already in print space. */
	manifold: Manifold;
	previewMesh: Mesh;
};

/**
 * Positive offset shrinks the blank (engraving depth + tolerance). Negative
 * offset grows it (the "bigger" outset). Same rules as the blanks export.
 */
export function blankOffsetMm(
	die: Pick<Dice, 'parameters' | 'face_parameters'>,
	values: OptionValues
): number {
	const bigger = Boolean(controlValue(controls, values, 'bigger'));
	if (bigger) {
		const outset = Number(controlValue(controls, values, 'outset')) || 0;
		return -outset;
	}
	const tolerance = Number(controlValue(controls, values, 'tolerance')) || 0;
	return maxEngravingDepth(die) + tolerance;
}

/**
 * The blank that export unions supports into. `params` are the numbered die's
 * params (before the offset). The manifold is print-oriented.
 */
export function buildPrintBlank(
	model: ExtraBuildContext['model'],
	params: Record<string, number>,
	stringParams: Record<string, string>,
	offset: number
): PrintBlank {
	const blankParams = model.blankParameters(params, offset);
	const built = model.build(blankParams, stringParams);
	// Print pose for the *resized* solid (extent changes with offset).
	const printingTransform =
		built.printingTransform ?? computePointDownPrintingTransform(built.faces);

	// Face-cap export shell (not prism-union) — same blank solid as engraving.
	const shell = assembleBlankExportShellGeometry(built.faces);
	const exported = buildBlankManifoldExport({
		model,
		params: blankParams,
		stringParams,
		faces: built.faces,
		exportGeometry: shell,
		offset: 0
	});
	shell.dispose();
	const oriented = exported.manifold.transform(transformToMat4(printingTransform));
	exported.manifold.delete();
	printingTransform.applyToGeometry(exported.previewMesh.geometry);
	return {
		faces: built.faces,
		printingTransform,
		manifold: oriented,
		previewMesh: exported.previewMesh
	};
}

// The deepest engraving on the die: its engraving depth parameter plus the
// largest per-face extra depth.
function maxEngravingDepth(die: Pick<Dice, 'parameters' | 'face_parameters'>): number {
	const base = die.parameters.engraving_depth ?? engravingParam.defaultValue;
	const extra = die.face_parameters.reduce((m, f) => Math.max(m, f?.extraDepth ?? 0), 0);
	return base + extra;
}
