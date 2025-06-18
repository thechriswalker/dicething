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
import type { Preset } from '$lib/interfaces/presets';

type EndsWith100<T extends string> = T extends `${string}_100` ? T : never;

export type GoFirstOptions = {
	rhombic?: boolean; // false = dodecahedron
	font?: EndsWith100<keyof typeof builtins>;
	size?: number; // face to face distance
};

const defaultSize = 22;

// this is parameterized, so maybe I can have preset with parameters?
export const goFirstPreset: Preset = async (opts: GoFirstOptions = {}) => {
	const kind = opts.rhombic ? 'rhombic_d12' : 'dodecahedron_d12';
	const parameters = { size: opts.size || defaultSize };
	const legends = await builtins[opts.font ?? 'germania_one_100'].load();
	const toFP = (i: number) => ({ legend: i });
	return {
		name: 'Go First Dice (4 Players)',
		legends,
		dice: [
			{
				kind,
				parameters,
				// Die 1: 1, 8, 11, 14, 19, 22, 27, 30, 35, 38, 41, 48
				face_parameters: [1, 8, 11, 14, 19, 22, 27, 30, 35, 38, 41, 48].map(toFP)
			},
			{
				kind,
				parameters,
				// Die 2: 2, 7, 10, 15, 18, 23, 26, 31, 34, 39, 42, 47
				face_parameters: [2, 7, 10, 15, 18, 23, 26, 31, 34, 39, 42, 47].map(toFP)
			},
			{
				kind,
				parameters,
				// Die 3: 3, 6, 12, 13, 17, 24, 25, 32, 36, 37, 43, 46
				face_parameters: [3, 6, 12, 13, 17, 24, 25, 32, 36, 37, 43, 46].map(toFP)
			},
			{
				kind,
				parameters,
				// Die 4: 4, 5, 9,  16, 20, 21, 28, 29, 33, 40, 44, 45
				face_parameters: [4, 5, 9, 16, 20, 21, 28, 29, 33, 40, 44, 45].map(toFP)
			}
		]
	};
};
