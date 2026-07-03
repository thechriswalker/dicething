import type { FaceParams } from '$lib/interfaces/dice';
import { m } from '$lib/paraglide/messages';
import { engravingParam } from '../builder';
import { Legend } from '../legends';
import { controlValue, type ExtraBuildContext, type ExtraBuildOption } from './types';

// A "blank": the same die shape with every face engraving removed (smooth
// faces), either:
//  - smaller (the normal case): inset by "max engraving depth + tolerance" so a
//    cast/painted blank fits inside the engraved master, or
//  - bigger (for making smooth dice): the die size outset by a fixed amount.
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

		// blankParameters / our scale fallback treat a positive offset as shrinking
		// the die (reduces face-to-face by 2 x offset) and negative as growing it.
		let offset: number;
		if (bigger) {
			const outset = Number(controlValue(controls, ctx.values, 'outset')) || 0;
			offset = -outset;
		} else {
			const tolerance = Number(controlValue(controls, ctx.values, 'tolerance')) || 0;
			offset = maxEngravingDepth(ctx) + tolerance;
		}

		// force every face blank.
		const blankFaceParams: Array<FaceParams> = ctx.builder
			.getFaces()
			.map(() => ({ legend: Legend.BLANK }));

		if (ctx.model.blankParameters) {
			// the die knows how to resize itself precisely.
			const params = ctx.model.blankParameters(ctx.die.parameters, offset);
			const mesh = ctx.builder.export(params, blankFaceParams, ctx.die.string_parameters ?? {});
			return [{ suffix: 'blank', mesh }];
		}

		// generic fallback: build blank at current size then uniformly scale the
		// mesh so the face-to-face distance changes by 2 x offset.
		const mesh = ctx.builder.export(
			ctx.die.parameters,
			blankFaceParams,
			ctx.die.string_parameters ?? {}
		);
		const f2f = ctx.builder.getFace2FaceDistance();
		if (offset !== 0 && f2f > 0) {
			const scale = (f2f - 2 * offset) / f2f;
			if (scale > 0) {
				mesh.geometry.scale(scale, scale, scale);
			}
		}
		return [{ suffix: 'blank', mesh }];
	}
};

// The deepest engraving on the die: its engraving depth parameter plus the
// largest per-face extra depth.
function maxEngravingDepth(ctx: ExtraBuildContext): number {
	const base = ctx.die.parameters.engraving_depth ?? engravingParam.defaultValue;
	const extra = ctx.die.face_parameters.reduce((m, f) => Math.max(m, f?.extraDepth ?? 0), 0);
	return base + extra;
}
