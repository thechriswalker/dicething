// Browser-side helpers for seeding new custom legend sets from a font file.
// (The offline builtin generator lives in $lib/fonts/build_builtins.ts.)
import builtins from '$lib/fonts';
import { getFont } from '$lib/interfaces/fontstore';
import dicethingLogo from '$lib/fonts/icons/dicething.svg?raw';
import {
	addRenderOptions,
	createShapesFromFont,
	createShapesFromSVG,
	createShapesFromSVGChecked,
	defaultStrings,
	numberStringToWords,
	zeroToNinetyNine
} from './font';
import {
	loadMutableLegends,
	type LegendFontOrigin,
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

// Resolve the source font for a legend set so the editor can generate more
// glyphs: builtin fonts are fetched from the bundle, uploaded fonts come from
// IndexedDB. Returns undefined if there's no source font available.
export async function getEditableFont(set: {
	id: string;
	font?: LegendFontOrigin;
}): Promise<ArrayBuffer | undefined> {
	const f = set.font;
	if (!f) {
		return undefined;
	}
	if (f.kind === 'builtin') {
		const b = builtins[f.builtinId as keyof typeof builtins];
		if (!b?.fontUrl) {
			return undefined;
		}
		const res = await fetch(b.fontUrl);
		return res.arrayBuffer();
	}
	return getFont(set.id);
}

// Render a single string from a font into (serialized) shapes for one slot.
export function shapesFromFontText(
	buffer: ArrayBufferLike,
	text: string,
	letterSpacing?: number
): Array<unknown> {
	const renderOptions = letterSpacing != null ? { letterSpacing } : undefined;
	const result = createShapesFromFont(buffer, [{ text, renderOptions }]);
	return result[0] as unknown as Array<unknown>;
}

// Parse an SVG string (paths with fill) into (serialized) shapes for one slot.
// Throws StrokeOnlySVGError if the SVG only has stroked paths.
export function shapesFromSVG(svg: string): Array<unknown> {
	return createShapesFromSVGChecked(svg) as unknown as Array<unknown>;
}
