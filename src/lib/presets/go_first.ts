/*
Go First Dice: permutation-fair sets for deciding play order.
  3 players → 3d6  (Robert Ford, 2010)
  4 players → 4d12 (Robert Ford, 2010)
  5 players → 5d60 (Paul Meyer, 2023) — needs five_player_voltaire for 100–300

Number arrangements live as per-die legend orderings (go_first_a..e) in
$lib/utils/legend_orderings so the preset and the face-edit dropdown share one
source of truth.
*/

import dice from '$lib/dice';
import builtins, { loadBuiltinById } from '$lib/fonts';
import type { Preset, PresetOptionDie, PresetOptionSelection } from '$lib/interfaces/presets';
import { FIVE_PLAYER_VOLTAIRE_BUILTIN } from '$lib/utils/legends';
import { legendPickerFactory, legendPickerOption } from './_util';

const shapesForSides = (sides: string): Array<string> =>
	Object.values(dice)
		.filter((d) => d.tags?.sides === sides)
		.map((d) => d.id);

const GO_FIRST_ORDERINGS = ['go_first_a', 'go_first_b', 'go_first_c', 'go_first_d', 'go_first_e'];

function pickShape(
	opts: Array<{ id: string; value?: unknown }>,
	id: string,
	fallback: string
): string {
	const opt = opts.find((o) => o.id === id) as PresetOptionDie | undefined;
	const v = opt?.value;
	return typeof v === 'string' && v.length > 0 ? v : fallback;
}

export const goFirstPreset: Preset = {
	id: 'go_first',
	options() {
		const d6 = shapesForSides('6');
		const d12 = shapesForSides('12');
		const d60 = shapesForSides('60');
		return [
			{
				kind: 'select',
				id: 'players',
				options: [
					['3', '3 players (3d6)'],
					['4', '4 players (4d12)'],
					['5', '5 players (5d60)']
				],
				value: '4'
			} satisfies PresetOptionSelection,
			legendPickerOption(builtins.germania_one.id),
			{
				kind: 'die',
				id: 'd6_shape',
				options: d6,
				value: d6.includes('d6_cube') ? 'd6_cube' : d6[0]
			},
			{
				kind: 'die',
				id: 'd12_shape',
				options: d12,
				value: d12.includes('d12_dodecahedron') ? 'd12_dodecahedron' : d12[0]
			},
			{
				kind: 'die',
				id: 'd60_shape',
				options: d60,
				value: d60.includes('d60_deltoidal_hexecontahedron')
					? 'd60_deltoidal_hexecontahedron'
					: d60[0]
			}
		];
	},
	async factory(opts) {
		const playersOpt = opts.find((o) => o.id === 'players') as PresetOptionSelection;
		const players = playersOpt?.value ?? '4';
		const legendOption = opts.find((o) => o.kind === 'legend')!;

		const sides = players === '3' ? '6' : players === '5' ? '60' : '12';
		const shapeId = players === '3' ? 'd6_shape' : players === '5' ? 'd60_shape' : 'd12_shape';
		const fallback =
			players === '3'
				? 'd6_cube'
				: players === '5'
					? 'd60_deltoidal_hexecontahedron'
					: 'd12_dodecahedron';
		const kind = pickShape(opts, shapeId, fallback) as keyof typeof dice;
		const count = Number(players);
		const orderings = GO_FIRST_ORDERINGS.slice(0, count);

		// 5d60 needs glyphs 100–300; only five_player_voltaire ships them.
		const legends =
			players === '5'
				? await loadBuiltinById(FIVE_PLAYER_VOLTAIRE_BUILTIN)
				: await legendPickerFactory(legendOption);

		return {
			legends,
			dice: orderings.map((legend_ordering) => ({
				kind,
				parameters: {},
				face_parameters: [],
				legend_ordering
			}))
		};
	}
};
