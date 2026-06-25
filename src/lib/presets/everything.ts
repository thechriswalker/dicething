import dice from '$lib/dice';
import type { Preset, PresetOption, PresetOptionSelection, UnidentifiedDiceSet } from '$lib/interfaces/presets';
import { legendPickerFactory, legendPickerOption } from './_util';

export const everythingPreset: Preset = {
    id: "everything",
    options() {
        return [legendPickerOption()];
    },
    async factory(opts: Array<PresetOption>) {
        return {
            legends: await legendPickerFactory(opts[0]),
            dice: Object.values(dice)
                .map((die) => {
                    return {
                        kind: die.id,
                        parameters: {},
                        face_parameters: []
                    } as UnidentifiedDiceSet['dice'][number];
                })
        };
    }
}
