// Browser-side helpers for seeding new custom legend sets from a font file.
// (The offline builtin generator lives in $lib/fonts/build_builtins.ts.)
import dicethingLogo from '$lib/fonts/icons/dicething.svg?raw';
import {
	addRenderOptions,
	createShapesFromFont,
	createShapesFromSVG,
	defaultStrings,
	numberStringToWords,
	zeroToNinetyNine
} from './font';
import {
	loadMutableLegends,
	type LegendSource,
	type MutableLegendSet,
	type SerialisedLegendSet
} from './legends';

export type LegendPreset = 'std' | '100';

// Build an editable legend set by rendering each glyph of the preset from the
// given font. The "std" preset also appends the app logo (the MAKER_LOGO slot).
export function legendSetFromFont(
	buffer: ArrayBufferLike,
	name: string,
	preset: LegendPreset,
	id: string = crypto.randomUUID()
): MutableLegendSet {
	const strings = addRenderOptions(preset === '100' ? zeroToNinetyNine : defaultStrings);
	// NB createShapesFromFont returns already-serialised shape JSON.
	const shapes = createShapesFromFont(buffer, strings) as unknown as Array<Array<unknown>>;
	const names = strings.map((s) => numberStringToWords(s.text));
	const sources: Array<LegendSource | null> = strings.map((s) => ({
		kind: 'font',
		text: s.text,
		letterSpacing: s.renderOptions?.letterSpacing
	}));

	if (preset === 'std') {
		// icons are authored at 24px, our standard glyph size is 10px.
		shapes.push(createShapesFromSVG(dicethingLogo, 10 / 24) as unknown as Array<unknown>);
		names.push('Logo');
		sources.push({ kind: 'svg' });
	}

	const serial: SerialisedLegendSet = {
		id,
		name,
		names,
		shapes,
		font: { kind: 'uploaded' },
		updated: Date.now(),
		sources
	};
	return loadMutableLegends(serial);
}
