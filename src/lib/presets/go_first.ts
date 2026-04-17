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

import builtins from '$lib/fonts';
import type { Preset, PresetOptionBoolean } from '$lib/interfaces/presets';
import { legendPickerFactory, legendPickerOption } from './_util';


const defaultSize = 20;

// this is parameterized, so maybe I can have preset with parameters?
export const goFirstPreset: Preset = {
	id: "go_first",
	options() {
		return [legendPickerOption("0-99", builtins.germania_one_100.id),
		{
			kind: "bool",
			id: " rhombic_vs_dodecahedron",
			value: false,
		}
		]
	},
	async factory(opts) {
		const [legendOption, rhombicOption] = opts;
		const kind = (rhombicOption as PresetOptionBoolean).value ? "rhombic_d12" : "dodecahedron_d12"
		const toFP = (i: number) => ({ legend: i });
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
