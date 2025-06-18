import { blanks } from '$lib/fonts';
import type { Preset } from '$lib/interfaces/presets';
import type { DiceSet } from '$lib/interfaces/storage.svelte';
import { goFirstPreset } from '$lib/presets/go_first';
import { uuid } from '$lib/utils/uuid';
import { classic } from './classic';

const dicething: Preset = () => ({
	dice: [],
	legends: blanks,
	name: 'New Dicething Set'
});

const go_first: Preset = goFirstPreset;

const scratch: Preset = () => ({
	dice: [],
	legends: blanks,
	name: 'New Dice Set'
});

const presets = {
	dicething,
	scratch,
	classic,
	go_first

} as const;

export type PresetName = keyof typeof presets;

export async function fromPreset(preset: Preset): Promise<DiceSet> {
	const base = (await preset()) as DiceSet;
	// this is going to way easier if we go "unsafe" as far as TS is concerned.
	(base.id = uuid()), (base.updated = Date.now());
	base.dice.forEach((x) => {
		x.id = uuid();
	});
	return base;
}

export { presets };
