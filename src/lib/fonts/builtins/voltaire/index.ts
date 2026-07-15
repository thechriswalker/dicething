import type { Builtin } from "../type";

export default {
    display_name: 'Voltaire',
    font_file: 'voltaire.ttf',
    license_file: 'license.txt',
    license_kind: 'SIL-OFL v1.1',
    render_options: {
        '6.': { letterSpacing: 0 },
        '9.': { letterSpacing: -0.05 }
    }
} satisfies Builtin;