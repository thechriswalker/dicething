import type { Builtin, FontRenderOptions } from '../type';

// Voltaire with tight tracking for three-digit Go First numbers (100–300).
// Shares the Voltaire TTF/license via symlinks; only this builtin generates
// glyphs past 99 by default (users can also build five-player sets from any font).
const TIGHT_LETTER_SPACING = -0.08;

function threeDigitTightOptions(): Record<string, FontRenderOptions> {
	const out: Record<string, FontRenderOptions> = {
		'6.': { letterSpacing: -0.1 },
		'9.': { letterSpacing: -0.1 }
	};
	for (let n = 100; n <= 300; n++) {
		const text = String(n);
		if (!text.includes('22')) {
			out[text] = { letterSpacing: TIGHT_LETTER_SPACING };
		}
	}
	return out;
}

export default {
	display_name: 'Five Player Voltaire',
	font_file: 'voltaire.ttf',
	license_file: 'license.txt',
	license_kind: 'SIL-OFL v1.1',
	character_set: 'five_player',
	render_options: threeDigitTightOptions()
} satisfies Builtin;
