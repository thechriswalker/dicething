import { defaultFont } from '$lib/fonts';
import type { Preset } from '$lib/interfaces/presets';
import { legendPickerFactory, legendPickerOption } from './_util';

export const classic: Preset = {
	id: "classic",
	options() {
		return [legendPickerOption(defaultFont.id)]
	},
	async factory(opts) {
		// the 7 dice classic dnd set
		return {
			legends: await legendPickerFactory(opts[0]),
			dice: [
				{
					kind: 'caltrop_d4',
					parameters: {
						caltrop_height: 15
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'cube_d6',
					parameters: {
						polyhedron_size: 15
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'trapezohedron_d8',
					parameters: {
						trapezohedron_radius: 13,
						trapezohedron_height: 26
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'trapezohedron_d10',
					parameters: { trapezohedron_radius: 12, trapezohedron_height: 20 } as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'trapezohedron_d00',
					parameters: { trapezohedron_radius: 12, trapezohedron_height: 20 } as Record<string, number>,
					face_parameters: []
				},
				{ kind: 'dodecahedron_d12', parameters: { polyhedron_size: 15 }, face_parameters: [] },
				{
					kind: 'icosahedron_d20',
					parameters: { polyhedron_size: 15 } as Record<string, number>,
					face_parameters: []
				}
			],
		}
	}
}
