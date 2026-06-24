import type { FaceParams } from '$lib/interfaces/dice';
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
		label: 'Bigger blank',
		default: false,
		help: 'Smaller blanks are the normal ones. Bigger blanks are for making smooth (un-engraved) dice.'
	},
	{
		id: 'tolerance',
		kind: 'number',
		label: 'Tolerance',
		min: 0,
		max: 10,
		step: 0.05,
		default: 0.7,
		unit: 'mm',
		help: 'Blank is inset by the max engraving depth of the die plus this tolerance.',
		visibleWhen: { control: 'bigger', equals: false }
	},
	{
		id: 'outset',
		kind: 'number',
		label: 'Outset',
		min: 0.1,
		max: 10,
		step: 0.05,
		default: 1,
		unit: 'mm',
		help: 'Blank is the die size outset (grown) by this amount.',
		visibleWhen: { control: 'bigger', equals: true }
	}
];

export const blanksOption: ExtraBuildOption = {
	id: 'blanks',
	label: 'Blanks',
	description: 'Identical shapes with no engraving.',
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
