// we should be able to use filesystem calls here and $lib functions
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';

import {
	addRenderOptions,
	createShapesFromFont,
	createShapesFromSVG,
	defaultStrings,
	defaultRenderOptions,
	type FontString,
	numberStringToWords,
	svgIconScale
} from '$lib/utils/font';
import { dirname, sep } from 'node:path';

import { DOMParser } from 'xmldom';
import type { Shape } from 'three';
import type { RenderOptions } from 'opentype.js';
import { shapesToSVGData } from '$lib/utils/shapes';
import { shapeFromJSON } from '$lib/utils/to_json';

const builtinPrefix = 'builtin:';

// patch this into global
globalThis.DOMParser = DOMParser;

async function createFontBasedLegends(
	src: string,
	dst: string,
	varname: string,
	name: string,
	strings: Array<FontString>,
	extraIcons?: Array<{ name: string; shapes: Array<Shape> }>
) {
	// load font from src.
	const data = (await readFile(src)).buffer;

	const shapes = createShapesFromFont(data, strings);
	const names = strings.map((s) => numberStringToWords(s.text));
	if (extraIcons) {
		extraIcons.forEach(({ name, shapes: icon }) => {
			shapes.push(icon);
			names.push(name);
		});
	}

	// write set to disk
	await writeFile(
		dst,
		JSON.stringify({
			id: builtinPrefix + varname,
			name,
			names,
			shapes: shapes
		}),
		{ encoding: 'utf8' }
	);

	// create a preview SVG of a small set of characters
	const previewShapes = createShapesFromFont(data, [{ text: '0123456789' }]);
	const svg = shapesToSVGData(previewShapes[0].map(shapeFromJSON));
	await writeFile(dst.replace(/\.json$/, '.svg'), svg, { encoding: 'utf8' });
}

const zero_to_ninety_nine: string = Array.from({ length: 100 })
	.map((_, i) => {
		return i == 6 ? '6.' : i == 9 ? '9.' : '' + i;
	})
	.join(' ');

async function loadSVGIcon(
	path: string,
	name: string
): Promise<{ name: string; shapes: Array<Shape> }> {
	const data = await readFile(path, { encoding: 'utf8' });
	// the icons could be any size; scale their viewBox down to our standard
	// glyph size (10px). same helper the browser-side generator uses.
	const shapes = createShapesFromSVG(data, svgIconScale(data));
	return { name, shapes };
}



async function buildAll() {
	const baseDir = new URL(dirname(import.meta.url)).pathname;
	const genSuffix = '/generated';

	const generated = baseDir + genSuffix;
	const builtins = baseDir + '/builtins';

	await mkdir(generated, { recursive: true });
	// and delete anything in it.
	for (let f of await readdir(generated)) {
		await unlink(generated + '/' + f);
	}

	const icons = await Promise.all([loadSVGIcon(baseDir + '/icons/dicething.svg', 'Logo')]);

	const fontMeta = [];
	for (let d of await readdir(builtins)) {
		// the source directory name, retained even after we mangle `d` for the
		// _100 variant, so both variants can reference the same TTF + license.
		const fontDir = d;
		const src = builtins + '/' + d + '/' + d + '.ttf';
		let dst = generated + '/' + d + '.json';
		// un_snake_case the name.
		let name = d
			.split('_')
			.map((s) => s[0].toUpperCase() + s.slice(1))
			.join(' ');
		// load the font specifics.
		let renderOptions = defaultRenderOptions;
		try {
			const { renderOptions: modRenderOptions } = await import(builtins + '/' + d + '/index.ts');
			renderOptions = modRenderOptions;
		} catch { }
		const strings = addRenderOptions(defaultStrings, renderOptions);
		await createFontBasedLegends(src, dst, d, name, strings, icons);
		fontMeta.push({
			varname: d,
			fontDir,
			name: JSON.stringify(name),
			tags: ['std'],
			import: JSON.stringify('.' + genSuffix + '/' + d + '.json')
		});
		// also make a 0-99 set, just because we can.
		d = d + '_100';
		dst = generated + '/' + d + '.json';
		name += ' (100)';
		await createFontBasedLegends(
			src,
			dst,
			d,
			name,
			addRenderOptions(zero_to_ninety_nine, renderOptions)
		);
		fontMeta.push({
			varname: d,
			fontDir,
			name: JSON.stringify(name),
			tags: ['0-99'],
			import: JSON.stringify('.' + genSuffix + '/' + d + '.json')
		});
	}

	// the source font + license imports are per source directory, shared by the
	// std and _100 variants, so dedupe by fontDir.
	const fontDirs = [...new Set(fontMeta.map((f) => f.fontDir))];

	let indexTemplate = `// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadImmutableLegends, type LegendSet } from "$lib/utils/legends";
${fontMeta.map((f) => `import ${f.varname}SVG from './generated/${f.varname}.svg';`).join('\n')}
${fontDirs.map((d) => `import ${d}FontUrl from './builtins/${d}/${d}.ttf?url';`).join('\n')}
${fontDirs.map((d) => `import ${d}License from './builtins/${d}/license.txt?raw';`).join('\n')}

const deferredFontLoader = (fontname: string) => {
	const fn = async () => {
		const data = await import(${'`./generated/${fontname}.json`'});
		return loadImmutableLegends(data);
	}
	let promise: ReturnType<typeof fn>;
	return () => {
		if(!promise) {
			promise = fn();
		}
		return promise;
	}
}

// all blanks
export const blanks = loadImmutableLegends({
	id: '${builtinPrefix}blanks',
	name: 'Blanks',
	names: [],
	shapes: []
});

export function isBuiltin(id: string): boolean {
	return id.startsWith('${builtinPrefix}');
}

export async function loadBuiltinById(id: string): Promise<LegendSet> {
	if(!isBuiltin(id)) {
		return blanks;
	}
	const key = id.slice(${builtinPrefix.length}) as keyof typeof builtins;
	return builtins[key].load();
}

export type Builtin = {
	readonly id: BuiltinID;
    readonly name: string;
	readonly tags: Array<string>;
	readonly preview: string;
	// URL to the source TTF (served from the bundle) so the legend editor can
	// generate more glyphs from a clone of this builtin. Empty for blanks.
	readonly fontUrl: string;
	// the font's license text, for attribution/display. Empty for blanks.
	readonly license: string;
    readonly load: () => Promise<ReturnType<typeof loadImmutableLegends>>;
}

type BuiltinID = "blanks"|"${fontMeta.map(x => x.varname).join('"|"')}";

const builtins: Record<BuiltinID, Builtin> = {
	blanks: { id: "blanks", name: "Blanks", tags: ["blank"], fontUrl: "", license: "", load: async () => blanks, preview: "" } as Builtin,
${fontMeta
			.map((x) => {
				return (
					'    ' +
					x.varname +
					': { id: "' + x.varname +
					'", name: ' + x.name +
					', tags: ' + JSON.stringify(x.tags) +
					', preview: ' + x.varname + 'SVG' +
					', fontUrl: ' + x.fontDir + 'FontUrl' +
					', license: ' + x.fontDir + 'License' +
					', load: deferredFontLoader("' + x.varname + '")' +
					' } as Builtin,'
				);
			})
			.join('\n')}
} as const;

export const defaultFont = builtins.germania_one;

export default builtins;
`;

	await writeFile(baseDir + '/index.ts', indexTemplate, { encoding: 'utf8' });
}

buildAll().catch((e) => console.error(e));
