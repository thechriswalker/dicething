import builtins from '$lib/fonts';
import type { Preset, UnidentifiedDiceSet } from '$lib/interfaces/presets';
import { Vector2 } from 'three';
import { legendPickerFactory, legendPickerOption } from './_util';

// This is my (github.com/thechriswalker) preset. This is how I
// like to have my dice. Note that it has 2 D6 (with small numbers and large numbers)
// and 2 D20s, one with a symbol on the crit.
// this is how I make my molds - with 9 dice.
export const myPreset: Preset = {
	id: "mine",
	options() {
		return [legendPickerOption(builtins.alice_in_wonderland.id)]
	},
	async factory(opts) {
		return {
			legends: await legendPickerFactory(opts[0]),
			dice: [
				{
					kind: 'd4_crystal',
					parameters: {
						crystal_height: 18,
						crystal_width: 12,
						crystal_cap: 6,
						crystal_twist: 0.25
					} as Record<string, number>,
					face_parameters: [
						{ rotation: -1.5707963267948966, scale: 1.3, offset: new Vector2(0, -3.5) },
						{ rotation: 1.5707963267948966, scale: 1.29, offset: new Vector2(0, 3.5) },
						{ rotation: 1.5707963267948966, scale: 1.3, offset: new Vector2(0, 3.5) },
						{ rotation: -1.5707963267948966, scale: 1.3, offset: new Vector2(0, -3.5) }
					]
				},
				{
					kind: 'd6_cube',
					parameters: {
						polyhedron_size: 18
					} as Record<string, number>,
					face_parameters: []
				},
				{
					kind: 'd6_cube',
					parameters: {
						polyhedron_size: 18
					} as Record<string, number>,
					face_parameters: [
						{ rotation: 1.5707963267948966, scale: 1.23, offset: new Vector2(-3.4, 5.4) },
						{ scale: 1.23, offset: new Vector2(3.4, -5.4), rotation: -1.5707963267948966 },
						{ scale: 1.23, offset: new Vector2(-3.4, 5.4), rotation: 1.5707963267948966 },
						{ rotation: 3.141592653589793, scale: 1.23, offset: new Vector2(-5.4, 3.4) },
						{ scale: 1.23, offset: new Vector2(5.4, 3.4) },
						{ offset: new Vector2(5.4, 3.4), scale: 1.23 }
					]
				},
				{
					kind: 'd8_trapezohedron',
					parameters: {
						trapezohedron_radius: 14,
						trapezohedron_height: 36
					} as Record<string, number>,
					face_parameters: [
						{ rotation: 0.4258603374866164, offset: new Vector2(3.9, -1.8) },
						{ rotation: 0.4258603374866164, offset: new Vector2(3.8, -1.8) },
						{ rotation: 0.4258603374866164, offset: new Vector2(3.9, -2.2) },
						{ rotation: 0.4258603374866164, offset: new Vector2(3.8, -2.7) },
						{ rotation: 0.4258603374866164, offset: new Vector2(3.8, -2.2) },
						{ rotation: 0.4258603374866164, offset: new Vector2(3.9, -2.4) },
						{ rotation: 0.4258603374866164, offset: new Vector2(4.2, -2.2) },
						{ rotation: 0.4258603374866164, offset: new Vector2(3.8, -2.4) }
					]
				},
				{
					kind: 'd10_trapezohedron',
					parameters: {
						trapezohedron_radius: 14,
						trapezohedron_height: 36
					} as Record<string, number>,
					face_parameters: [
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.8, -2.0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.8, -2.0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.8, -2.0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.8, -2.0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.8, -2.0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.4, -0.9) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.8, -2.0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.8, -2.0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.4, -0.9) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.8, -2.0) }
					]
				},
				{
					kind: 'd00_trapezohedron',
					parameters: {
						trapezohedron_radius: 14,
						trapezohedron_height: 36
					} as Record<string, number>,
					face_parameters: [
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) },
						{ rotation: 1.1868238913561442, scale: 1, offset: new Vector2(-1.3, 0) }
					]
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
				},
				{
					kind: 'd20_icosahedron',
					parameters: {
						polyhedron_size: 25
					} as Record<string, number>,
					face_parameters: [
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{},
						{ legend: 31 }
					]
				}
			]
		}
	}
}
