import builtins from "$lib/fonts";
import type { PresetOption, PresetOptionSelection } from "$lib/interfaces/presets";
import type { LegendSet } from "$lib/utils/legends";

export function legendPickerOption(tag: string, defaultValue: keyof typeof builtins): PresetOptionSelection {
    return {
        id: "legend",
        kind: "select",
        options: Object.entries(builtins).filter(([k, v]) => {
            return v.tags.includes(tag);
        }).map(([k, v]) => k),
        value: defaultValue,
    }
}

export async function legendPickerFactory(o: PresetOption): Promise<LegendSet> {
    const id = (o as PresetOptionSelection).value;
    const font = builtins[id as keyof typeof builtins];
    return await font.load();
}