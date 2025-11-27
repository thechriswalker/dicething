import builtins from '$lib/fonts';
import type { Preset, UnidentifiedDiceSet } from '$lib/interfaces/presets';
import { Vector2 } from 'three';

// This is my (github.com/thechriswalker) preset. This is how I
// like to have my dice. Note that it has 2 D6 (with small numbers and large numbers)
// and 2 D20s, one with a symbol on the crit.
// this is how I make my molds - with 9 dice.
export const myPreset: Preset = async () => {
	const dice: UnidentifiedDiceSet['dice'] = [
		{
			kind: 'crystal_d4',
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
			kind: 'cube_d6',
			parameters: {
				polyhedron_size: 18
			} as Record<string, number>,
			face_parameters: []
		},
		{
			kind: 'cube_d6',
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
			kind: 'trapezohedron_d8',
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
			kind: 'trapezohedron_d10',
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
			kind: 'trapezohedron_d00',
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
			kind: 'dodecahedron_d12',
			parameters: {
				polyhedron_size: 22
			} as Record<string, number>,
			face_parameters: []
		},
		{
			kind: 'icosahedron_d20',
			parameters: {
				polyhedron_size: 25
			} as Record<string, number>,
			face_parameters: []
		},
		{
			kind: 'icosahedron_d20',
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
	];

	// the 7 default dicething set
	return {
		dice,
		legends: await builtins.alice_in_wonderland.load(),
		name: 'I wanna be like Chris'
	};
};
