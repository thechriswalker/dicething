import type { PresetOption, PresetOptionLegend } from '$lib/interfaces/presets';
import { getPreferences } from '$lib/interfaces/preferences.svelte';
import { loadLegends } from '$lib/interfaces/storage.svelte';
import type { LegendSet } from '$lib/utils/legends';

// the pre-selected legend set in the new-set picker. When a preset doesn't pass
// an explicit value it falls back to the user's preferred default legend set.
export function legendPickerOption(defaultValue?: string): PresetOptionLegend {
	return {
		id: 'legend',
		kind: 'legend',
		value: defaultValue ?? getPreferences().defaultLegendSet
	};
}

export async function legendPickerFactory(o: PresetOption): Promise<LegendSet> {
	const id = (o as PresetOptionLegend).value;
	// the picker can return a builtin id or a custom legend set id; loadLegends
	// resolves either (falling back to blanks for an unknown id).
	return await loadLegends(id);
}
