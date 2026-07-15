import type { RenderOptions } from "opentype.js";

export type Builtin = {
    display_name?: string;
    font_file?: string;
    license_file?: string;
    license_kind?: string;
    render_options?: Record<string, RenderOptions>;
}
