import { defaultFont } from "$lib/fonts"
import type { Preset } from "$lib/interfaces/presets"
import { legendPickerFactory, legendPickerOption } from "./_util"

export const empty: Preset = {
    id: "scratch",
    options() {
        return [legendPickerOption(defaultFont.id)];
    },
    async factory(opts) {
        return {
            legends: await legendPickerFactory(opts[0]),
            dice: []
        }
    }
}