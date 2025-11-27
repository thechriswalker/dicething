import { defaultFont } from '$lib/fonts';
import type { Preset, UnidentifiedDiceSet } from '$lib/interfaces/presets';
import { Vector2 } from 'three';

export const dicethingPreset: Preset = async () => {
	const dice: UnidentifiedDiceSet['dice'] = [
		{
			kind: 'crystal_d4',
			parameters: {
				crystal_height: 18,
				crystal_width: 12,
				crystal_cap: 6,
				crystal_twist: 0.5
			} as Record<string, number>,
			face_parameters: []
		},
		{
			kind: 'cube_d6',
			parameters: {
				polyhedron_size: 18
			} as Record<string, number>,
			face_parameters: []
		},
		{
			kind: 'trapezohedron_d8',
			parameters: {
				trapezohedron_radius: 14,
				trapezohedron_height: 36
			} as Record<string, number>,
			face_parameters: []
		},
		{
			kind: 'trapezohedron_d10',
			parameters: {
				trapezohedron_radius: 14,
				trapezohedron_height: 36
			} as Record<string, number>,
			face_parameters: []
		},
		{
			kind: 'trapezohedron_d00',
			parameters: {
				trapezohedron_radius: 14,
				trapezohedron_height: 36
			} as Record<string, number>,
			face_parameters: []
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
		}
	];

	// the 7 default dicething set
	return {
		dice,
		legends: await defaultFont.load(),
		name: 'New DiceThing Set'
	};
};
