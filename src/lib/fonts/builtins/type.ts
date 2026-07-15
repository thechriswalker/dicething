/** Per-glyph render tweaks (letter-spacing in ems of the legend font size). */
export type FontRenderOptions = {
	letterSpacing?: number;
};

export type Builtin = {
	display_name?: string;
	font_file?: string;
	license_file?: string;
	license_kind?: string;
	render_options?: Record<string, FontRenderOptions>;
};
