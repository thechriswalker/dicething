import { m } from '$lib/paraglide/messages';
import {
	assembleBlankExportShellGeometry,
	buildBlankManifoldExport,
	transformToMat4
} from '../die_manifold';
import { engravingParam } from '../builder';
import { computePointDownPrintingTransform } from '../printing';
import { controlValue, type ExtraBuildContext, type ExtraBuildOption } from './types';

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
		const bigger = Boolean(controlValue(controls, ctx.values, 'bigger'));

		// Positive offset shrinks the blank; negative offset grows it.
		let offset: number;
		if (bigger) {
			const outset = Number(controlValue(controls, ctx.values, 'outset')) || 0;
			offset = -outset;
		} else {
			const tolerance = Number(controlValue(controls, ctx.values, 'tolerance')) || 0;
			offset = maxEngravingDepth(ctx) + tolerance;
		}

		const params = ctx.builder.getLastDieParams();
		const stringParams = ctx.builder.getLastStringParams();
		const blankParams = ctx.model.blankParameters(params, offset);
		const built = ctx.model.build(blankParams, stringParams);
		// Print pose for the *resized* solid (extent changes with offset).
		const printT =
			built.printingTransform ?? computePointDownPrintingTransform(built.faces);

		// Face-cap export shell (not prism-union) — same blank solid as engraving.
		const shell = assembleBlankExportShellGeometry(built.faces);
		const exported = buildBlankManifoldExport({
			model: ctx.model,
			params: blankParams,
			stringParams,
			faces: built.faces,
			exportGeometry: shell,
			offset: 0
		});
		shell.dispose();
		const printMat = transformToMat4(printT);
		const oriented = exported.manifold.transform(printMat);
		exported.manifold.delete();
		printT.applyToGeometry(exported.previewMesh.geometry);
		return [{ suffix: 'blank', mesh: exported.previewMesh, manifold: oriented }];
	}
};

// The deepest engraving on the die: its engraving depth parameter plus the
// largest per-face extra depth.
function maxEngravingDepth(ctx: ExtraBuildContext): number {
	const base = ctx.die.parameters.engraving_depth ?? engravingParam.defaultValue;
	const extra = ctx.die.face_parameters.reduce((m, f) => Math.max(m, f?.extraDepth ?? 0), 0);
	return base + extra;
}
