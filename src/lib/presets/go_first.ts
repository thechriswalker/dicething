/*
will use as a "preset"

Go First Dice for 4 players. using the _100 fonts
and numbering the dice correctly, as follows.
Apparently we can still us a largest-opposite-smallest
configuration for the numbers on each of these D12s.

Die 1: 1, 8, 11, 14, 19, 22, 27, 30, 35, 38, 41, 48
Die 2: 2, 7, 10, 15, 18, 23, 26, 31, 34, 39, 42, 47
Die 3: 3, 6, 12, 13, 17, 24, 25, 32, 36, 37, 43, 46
Die 4: 4, 5, 9,  16, 20, 21, 28, 29, 33, 40, 44, 45 

*/

import dice from '$lib/dice';
import builtins from '$lib/fonts';
import type { Preset, PresetOptionDie } from '$lib/interfaces/presets';
import { legendPickerFactory, legendPickerOption } from './_util';

// every registered die with 12 sides is a valid shape for these go-first D12s.
const d12Shapes = (): Array<string> =>
	Object.values(dice)
		.filter((d) => d.tags?.sides === '12')
		.map((d) => d.id);

// this is parameterized, so maybe I can have preset with parameters?
export const goFirstPreset: Preset = {
	id: 'go_first',
	options() {
		const shapes = d12Shapes();
		return [
			legendPickerOption(builtins.germania_one.id),
			{
				kind: 'die',
				id: 'd12_shape',
				options: shapes,
				value: shapes.includes('d12_dodecahedron') ? 'd12_dodecahedron' : shapes[0]
			}
		];
	},
	async factory(opts) {
		const [legendOption, shapeOption] = opts;
		const kind = (shapeOption as PresetOptionDie).value as keyof typeof dice;
		// the four Go First arrangements now live as per-die legend orderings (see
		// $lib/dice/legend_orderings); each die just selects one. The builder fills
		// in the actual face legends from the ordering.
		return {
			legends: await legendPickerFactory(legendOption),
			dice: [
				{ kind, parameters: {}, face_parameters: [], legend_ordering: 'go_first_a' },
				{ kind, parameters: {}, face_parameters: [], legend_ordering: 'go_first_b' },
				{ kind, parameters: {}, face_parameters: [], legend_ordering: 'go_first_c' },
				{ kind, parameters: {}, face_parameters: [], legend_ordering: 'go_first_d' }
			]
		};
	}
};
