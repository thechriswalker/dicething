// we should be able to use filesystem calls here and $lib functions
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';

import {
	addRenderOptions,
	createShapesFromFont,
	createShapesFromSVG,
	defaultStrings,
	defaultRenderOptions,
	type FontString,
	svgIconScale
} from '$lib/utils/font';
import { MAKER_LOGO_SLOT } from '$lib/utils/legends';
import { dirname } from 'node:path';

import { DOMParser } from 'xmldom';
import type { Shape } from 'three';
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
	if (extraIcons) {
		// splice the icons (the maker logo) in at MAKER_LOGO_SLOT so the standard
		// slots (0-30) stay put and the remaining numbers fall at 32+.
		extraIcons.forEach(({ name, shapes: icon }, i) => {
			const at = MAKER_LOGO_SLOT + i;
			shapes.splice(at, 0, icon);
		});
	}

	// write set to disk
	await writeFile(
		dst,
		JSON.stringify({
			id: builtinPrefix + varname,
			name,
			shapes: shapes
		}),
		{ encoding: 'utf8' }
	);

	// create a preview SVG of a small set of characters
	const previewShapes = createShapesFromFont(data, [{ text: '0123456789' }]);
	const svg = shapesToSVGData(previewShapes[0].map(shapeFromJSON));
	await writeFile(dst.replace(/\.json$/, '.svg'), svg, { encoding: 'utf8' });
}

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
	for (const entry of await readdir(builtins, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const d = entry.name;
		const fontDir = d;
		console.log("loading font:", d)
		const {default: mod } = await import(builtins + '/' + d + '/index.ts');
		console.log("font:", mod)
		const src = builtins + '/' + d + '/' + mod.font_file;
		const dst = generated + '/' + d + '.json';
		const renderOptions = mod.render_options ?? defaultRenderOptions;
		const strings = addRenderOptions(defaultStrings, renderOptions);
		await createFontBasedLegends(src, dst, d, mod.display_name, strings, icons);
		fontMeta.push({
			varname: d,
			fontDir,
			fontFile: mod.font_file,
			licenseFile: mod.license_file,
			licenseKind: JSON.stringify(mod.license_kind),
			name: JSON.stringify(mod.display_name),
			import: JSON.stringify('.' + genSuffix + '/' + d + '.json')
		});
	}

	let indexTemplate = `// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadImmutableLegends, type LegendSet } from "$lib/utils/legends";
${fontMeta.map((f) => `import ${f.varname}SVG from './generated/${f.varname}.svg';`).join('\n')}
${fontMeta.map((d) => `import ${d.varname}FontUrl from './builtins/${d.fontDir}/${d.fontFile}?url';`).join('\n')}
${fontMeta.map((d) => `import ${d.varname}License from './builtins/${d.fontDir}/${d.licenseFile}?raw';`).join('\n')}

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
	readonly preview: string;
	// URL to the source TTF (served from the bundle) so the legend editor can
	// generate more glyphs from a clone of this builtin. Empty for blanks.
	readonly fontUrl: string;
	// the font's license text, for attribution/display. Empty for blanks.
	readonly license: string;
	readonly licenseKind: string;
    readonly load: () => Promise<ReturnType<typeof loadImmutableLegends>>;
}

type BuiltinID = "blanks"|"${fontMeta.map((x) => x.varname).join('"|"')}";

const builtins: Record<BuiltinID, Builtin> = {
	blanks: { id: "blanks", name: "Blanks", fontUrl: "", license: "", licenseKind: "", load: async () => blanks, preview: "" } as Builtin,
${fontMeta
	.map((x) => {
		return (
			'    ' +
			x.varname +
			': { id: "' +
			x.varname +
			'", name: ' +
			x.name +
			', preview: ' +
			x.varname +
			'SVG' +
			', fontUrl: ' +
			x.fontDir +
			'FontUrl' +
			', license: ' +
			x.fontDir +
			'License' +
			', licenseKind: ' +
			x.licenseKind +
			', load: deferredFontLoader("' +
			x.varname +
			'")' +
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
