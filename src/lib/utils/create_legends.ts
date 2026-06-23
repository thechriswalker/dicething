// Browser-side helpers for seeding new custom legend sets from a font file.
// (The offline builtin generator lives in $lib/fonts/build_builtins.ts.)
import builtins from '$lib/fonts';
import { getFont } from '$lib/interfaces/fontstore';
import dicethingLogo from '$lib/fonts/icons/dicething.svg?raw';
import {
	addRenderOptions,
	createOutlineFromSVG,
	createShapesFromFont,
	createShapesFromSVG,
	createShapesFromSVGChecked,
	defaultStrings,
	finalizeImportedShapes,
	numberStringToWords,
	svgIconScale,
	svgPieces,
	unsupportedSVGElements,
	zeroToNinetyNine,
	type SvgPiece
} from './font';

export type { SvgPiece, SvgPieceAction } from './font';
import type { Shape } from 'three';
import { shapesRowToSVGData } from './shapes';
import {
	loadMutableLegends,
	type LegendFontOrigin,
	type LegendSet,
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
		// scale the logo from its own viewBox down to our standard glyph size,
		// matching the offline builtin generator (see build_builtins loadSVGIcon).
		shapes.push(
			createShapesFromSVG(dicethingLogo, svgIconScale(dicethingLogo)) as unknown as Array<unknown>
		);
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
		sources,
		tags: [preset === '100' ? '0-99' : 'std']
	};
	return loadMutableLegends(serial);
}

// Rebuild the per-slot generation recipe (sources) for a builtin legend set from
// its classification tag. Builtins are generated offline from a known set of
// strings (see build_builtins.ts) but the bundled JSON doesn't carry the
// per-slot sources, so a fresh clone has no "characters" to show/edit. We
// reconstruct them here from the tag (which tells us the FontString[] used).
export function defaultSourcesForTag(tag: string): Array<LegendSource | null> {
	const strings = addRenderOptions(tag === '0-99' ? zeroToNinetyNine : defaultStrings);
	const sources: Array<LegendSource | null> = strings.map((s) => ({
		kind: 'font',
		text: s.text,
		letterSpacing: s.renderOptions?.letterSpacing
	}));
	// the "std" preset appends the app logo (the MAKER_LOGO slot), imported as SVG.
	if (tag !== '0-99') {
		sources.push({ kind: 'svg' });
	}
	return sources;
}

// Generate a preview image (an SVG data URL) for a legend set on the fly, by
// laying out its first `count` non-blank glyphs in a row. Builtins ship a
// prebuilt preview SVG; this gives custom sets a matching, evenly-spaced one
// without needing a stored image.
export function legendSetPreview(set: LegendSet, count: number = 10): string {
	const glyphs: Array<Array<Shape>> = [];
	for (const l of set) {
		if (glyphs.length >= count) {
			break;
		}
		const shapes = set.get(l);
		if (shapes.length > 0) {
			glyphs.push(shapes);
		}
	}
	const svg = shapesRowToSVGData(glyphs);
	return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
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

// Parse an SVG string (paths with fill) into (serialized) shapes for one slot,
// fitted to legend size. Throws StrokeOnlySVGError if the SVG only has strokes.
export function shapesFromSVG(svg: string): Array<unknown> {
	return finalizeImportedShapes(createShapesFromSVGChecked(svg) as unknown as Array<unknown>);
}

// Trace the outline of an SVG's stroked paths into shapes, fitted to legend size.
export function outlineFromSVG(svg: string): Array<unknown> {
	return createOutlineFromSVG(svg) as unknown as Array<unknown>;
}

// Split an SVG into individually selectable pieces (compound paths separated),
// each offering a traced-stroke and/or filled interpretation.
export function svgImportPieces(svg: string): Array<SvgPiece> {
	return svgPieces(svg);
}

// Combine the user's per-piece selections into fitted shapes for one slot.
export function combineImportPieces(shapes: Array<unknown>): Array<unknown> {
	return finalizeImportedShapes(shapes);
}

// Elements in an SVG we can't import (text, images, etc.).
export function svgUnsupportedElements(svg: string): Array<string> {
	return unsupportedSVGElements(svg);
}
