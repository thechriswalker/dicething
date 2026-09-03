/** Per-glyph render tweaks (letter-spacing in ems of the legend font size). */
export type FontRenderOptions = {
	letterSpacing?: number;
};

/** Which character set `build_builtins` generates for this font. */
export type BuiltinCharacterSet = 'default' | 'five_player';

export type Builtin = {
	display_name?: string;
	font_file?: string;
	license_file?: string;
	license_kind?: string;
	render_options?: Record<string, FontRenderOptions>;
	// applied to every glyph unless overridden in render_options.
	default_letter_spacing?: number;
	// 'five_player' adds glyphs 100–300 after the standard 0–99 set (for Go First 5d60).
	character_set?: BuiltinCharacterSet;
};
