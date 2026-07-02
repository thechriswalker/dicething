import type { Preset } from '$lib/interfaces/presets';
import { legendPickerFactory, legendPickerOption } from './_util';

export const classic: Preset = {
	id: 'classic',
	options() {
		return [legendPickerOption()];
	},
	async factory(opts) {
		// the 7 dice classic dnd set
		return {
			legends: await legendPickerFactory(opts[0]),
			dice: [
				{
					kind: 'd4_caltrop',
					parameters: {
						caltrop_height: 17
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd6_cube',
					parameters: {
						polyhedron_size: 16
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd8_trapezohedron',
					parameters: {
						trapezohedron_radius: 12.1,
						trapezohedron_height: 24.2
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd10_trapezohedron',
					parameters: { trapezohedron_radius: 11, trapezohedron_height: 22 } as Record<
						string,
						number
					>,
					face_parameters: []
				},
				{
					kind: 'd00_trapezohedron',
					parameters: { trapezohedron_radius: 11, trapezohedron_height: 22 } as Record<
						string,
						number
					>,
					face_parameters: []
				},
				{ kind: 'd12_dodecahedron', parameters: { polyhedron_size: 15 }, face_parameters: [] },
				{
					kind: 'd20_icosahedron',
					parameters: { polyhedron_size: 19.5 } as Record<string, number>,
					face_parameters: []
				}
			]
		};
	}
};
