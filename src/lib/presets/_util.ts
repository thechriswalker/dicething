import builtins from "$lib/fonts";
import type { PresetOption, PresetOptionLegend, PresetOptionSelection } from "$lib/interfaces/presets";
import { loadLegends } from "$lib/interfaces/storage.svelte";
import type { LegendSet } from "$lib/utils/legends";

export function legendPickerOption(defaultValue: keyof typeof builtins): PresetOptionLegend {
    return {
        id: "legend",
        kind: "legend",
        value: defaultValue,
    }
}

export async function legendPickerFactory(o: PresetOption): Promise<LegendSet> {
    const id = (o as PresetOptionLegend).value;
    // the picker can return a builtin id or a custom legend set id; loadLegends
    // resolves either (falling back to blanks for an unknown id).
    return await loadLegends(id);
}