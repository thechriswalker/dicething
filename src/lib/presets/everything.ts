import dice from "$lib/dice"
import { defaultFont } from "$lib/fonts";
import type { Preset, UnidentifiedDiceSet } from "$lib/interfaces/presets";

export const everythingPreset: Preset = async () => {
    return {
        legends: await defaultFont.load(),
        name: 'One of Everything',
        dice: Object.values(dice).map((die) => {
            return {
                kind: die.id,
                parameters: {},
                face_parameters: [],
            } as UnidentifiedDiceSet['dice'][number]
        })
    };
}