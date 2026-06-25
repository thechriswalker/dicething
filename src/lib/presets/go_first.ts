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
import { legendForValue } from '$lib/utils/legends';
import { legendPickerFactory, legendPickerOption } from './_util';


const defaultSize = 20;

// every registered die with 12 sides is a valid shape for these go-first D12s.
const d12Shapes = (): Array<string> =>
	Object.values(dice)
		.filter((d) => d.tags?.sides === '12')
		.map((d) => d.id);

// this is parameterized, so maybe I can have preset with parameters?
export const goFirstPreset: Preset = {
	id: "go_first",
	options() {
		const shapes = d12Shapes();
		return [legendPickerOption(builtins.germania_one.id),
		{
			kind: "die",
			id: "d12_shape",
			options: shapes,
			value: shapes.includes("d12_dodecahedron") ? "d12_dodecahedron" : shapes[0],
		}
		]
	},
	async factory(opts) {
		const [legendOption, shapeOption] = opts;
		const kind = (shapeOption as PresetOptionDie).value as keyof typeof dice;
		// map each face value to its slot in the combined legend set (values > 20
		// no longer equal their slot index).
		const toFP = (i: number) => ({ legend: legendForValue(i) });
		return {
			legends: await legendPickerFactory(legendOption),
			dice: [
				{
					kind,
					parameters: {},
					// Die 1: 1, 8, 11, 14, 19, 22, 27, 30, 35, 38, 41, 48
					face_parameters: [1, 8, 11, 14, 19, 22, 27, 30, 35, 38, 41, 48].map(toFP)
				},
				{
					kind,
					parameters: {},
					// Die 2: 2, 7, 10, 15, 18, 23, 26, 31, 34, 39, 42, 47
					face_parameters: [2, 7, 10, 15, 18, 23, 26, 31, 34, 39, 42, 47].map(toFP)
				},
				{
					kind,
					parameters: {},
					// Die 3: 3, 6, 12, 13, 17, 24, 25, 32, 36, 37, 43, 46
					face_parameters: [3, 6, 12, 13, 17, 24, 25, 32, 36, 37, 43, 46].map(toFP)
				},
				{
					kind,
					parameters: {},
					// Die 4: 4, 5, 9,  16, 20, 21, 28, 29, 33, 40, 44, 45
					face_parameters: [4, 5, 9, 16, 20, 21, 28, 29, 33, 40, 44, 45].map(toFP)
				}
			]
		};
	}
}
