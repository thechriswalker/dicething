import type { Preset } from '$lib/interfaces/presets';
import { legendPickerFactory, legendPickerOption } from './_util';

export const classic: Preset = {
	id: "classic",
	options() {
		return [legendPickerOption()]
	},
	async factory(opts) {
		// the 7 dice classic dnd set
		return {
			legends: await legendPickerFactory(opts[0]),
			dice: [
				{
					kind: 'd4_caltrop',
					parameters: {
						caltrop_height: 15
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd6_cube',
					parameters: {
						polyhedron_size: 15
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd8_trapezohedron',
					parameters: {
						trapezohedron_radius: 13,
						trapezohedron_height: 26
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd10_trapezohedron',
					parameters: { trapezohedron_radius: 12, trapezohedron_height: 20 } as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd00_trapezohedron',
					parameters: { trapezohedron_radius: 12, trapezohedron_height: 20 } as Record<string, number>,
					face_parameters: []
				},
				{ kind: 'd12_dodecahedron', parameters: { polyhedron_size: 15 }, face_parameters: [] },
				{
					kind: 'd20_icosahedron',
					parameters: { polyhedron_size: 15 } as Record<string, number>,
					face_parameters: []
				}
			],
		}
	}
}
