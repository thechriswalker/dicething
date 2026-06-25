import { getPreferences } from '$lib/interfaces/preferences.svelte';
import type { Preset, PresetOption } from '$lib/interfaces/presets';
import type { DiceSet } from '$lib/interfaces/storage.svelte';
import { goFirstPreset } from '$lib/presets/go_first';
import { uuid } from '$lib/utils/uuid';
import { classic } from './classic';
import { dicethingPreset } from './dicething';
import { everythingPreset } from './everything';
import { myPreset } from './mine';
import { empty } from './empty';

const presets = [empty, classic, dicethingPreset, myPreset, goFirstPreset, everythingPreset];

export async function fromPreset(
	preset: Preset,
	name: string,
	options: Array<PresetOption>
): Promise<DiceSet> {
	const base = (await preset.factory(options)) as DiceSet;
	base.name = name;
	// this is going to way easier if we go "unsafe" as far as TS is concerned.
	base.id = uuid();
	base.updated = Date.now();
	const prefs = getPreferences();
	base.dice.forEach((x) => {
		x.id = uuid();
		// seed the user's preferred engraving defaults unless the preset set them.
		x.parameters.engraving_depth ??= prefs.defaultEngravingDepth;
		x.parameters.engraving_tolerance ??= prefs.defaultEngravingTolerance;
	});
	return base;
}

export { presets };
