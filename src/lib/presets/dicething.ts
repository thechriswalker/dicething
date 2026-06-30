import type { Preset, UnidentifiedDiceSet } from '$lib/interfaces/presets';
import { Vector2 } from 'three';
import { legendPickerFactory, legendPickerOption } from './_util';

export const dicethingPreset: Preset = {
	id: 'dicething',
	options() {
		return [legendPickerOption()];
	},
	async factory(opts) {
		return {
			legends: await legendPickerFactory(opts[0]),
			dice: [
				{
					kind: 'd4_crystal',
					parameters: {
						crystal_height: 18,
						crystal_width: 10.5,
						crystal_cap: 6,
						crystal_twist: 0.5
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd6_cube',
					parameters: {
						polyhedron_size: 18
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd8_trapezohedron',
					parameters: {
						trapezohedron_radius: 14,
						trapezohedron_height: 36
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd10_trapezohedron',
					parameters: {
						trapezohedron_radius: 14,
						trapezohedron_height: 36
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd00_trapezohedron',
					parameters: {
						trapezohedron_radius: 14,
						trapezohedron_height: 36
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd12_dodecahedron',
					parameters: {
						polyhedron_size: 22
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd20_icosahedron',
					parameters: {
						polyhedron_size: 25
					} as Record<string, number>,
					face_parameters: []
				}
			]
		};
	}
};
