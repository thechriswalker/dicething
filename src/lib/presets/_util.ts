import builtins from "$lib/fonts";
import type { PresetOption, PresetOptionLegend, PresetOptionSelection } from "$lib/interfaces/presets";
import type { LegendSet } from "$lib/utils/legends";

export function legendPickerOption(tag: string, defaultValue: keyof typeof builtins): PresetOptionLegend {
    return {
        id: "legend",
        kind: "legend",
        filter: tag,
        value: defaultValue,
    }
}

export async function legendPickerFactory(o: PresetOption): Promise<LegendSet> {
    const id = (o as PresetOptionLegend).value;
    const font = builtins[id as keyof typeof builtins];
    return await font.load();
}