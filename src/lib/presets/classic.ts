import { defaultFont } from "$lib/fonts";
import type { Preset } from "$lib/interfaces/presets";

export const classic: Preset = async () => ({
    // the 7 dice classic dnd set
    dice: [
        {
            kind: "caltrop_d4",
            parameters: {},
            face_parameters: [],
        },
        {
            kind: "cube_d6",
            parameters: {},
            face_parameters: []
        },
        {
            kind: "trapezohedron_d8",
            parameters: {},
            face_parameters: []
        },
        {
            kind: "trapezohedron_d10",
            parameters: {},
            face_parameters: []
        },
        {
            kind: "trapezohedron_d00",
            parameters: {},
            face_parameters: []
        },
        { kind: "dodecahedron_d12", parameters: {}, face_parameters: [] },
        {
            kind: "icosahedron_d20",
            parameters: {},
            face_parameters: []
        },
    ],
    legends: await defaultFont.load(),
    name: 'New Classic Set'
});


