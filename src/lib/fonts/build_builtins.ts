// we should be able to use filesystem calls here and $lib functions
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';

import {
	addRenderOptions,
	createShapesFromFont,
	createShapesFromSVG,
	defaultStrings,
	type FontString
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
	// svg icons should be 24x24 px, but our standard size is 10px
	const shapes = createShapesFromSVG(data, 10 / 24);
	return { name, shapes };
}

const defaultRenderOptions: Record<string, RenderOptions> = {
	'6.': { letterSpacing: -0.1 },
	'9.': { letterSpacing: -0.1 }
};

// the teens and the
const specialCases: Record<string, string> = {
	'0': 'Zero',
	'00': 'Double Zero',
	'6.': 'Marked Six',
	'9.': 'Marked Nine',
	'11': 'Eleven',
	'12': 'Twelve',
	'13': 'Thirteen',
	'14': 'Fourteen',
	'15': 'Fifteen',
	'16': 'Sixteen',
	'17': 'Seventeen',
	'18': 'Eighteen',
	'19': 'Nineteen'
};
const ones: Array<string> = [
	'', // zero
	'One',
	'Two',
	'Three',
	'Four',
	'Five',
	'Six',
	'Seven',
	'Eight',
	'Nine'
];
const tens: Array<string> = [
	'', // <10
	'Ten',
	'Twenty',
	'Thirty',
	'Forty',
	'Fifty',
	'Sixty',
	'Seventy',
	'Eighty',
	'Ninety'
];
// only english and only up to 99.
function numberStringToWords(s: string): string {
	// special cases first.
	if (s in specialCases) {
		return specialCases[s];
	}
	const n = parseInt(s, 10);
	if (!Number.isInteger(n)) {
		throw new Error(`Attempt to use non-integer symbol in builtin: ${s}`);
	}
	if (n < 0 || n > 99) {
		throw new Error(`Attempt to use out-of-range symbol in builtin: ${s}`);
	}
	const o = ones[n % 10];
	const t = tens[Math.floor(n / 10)];
	return [t, o].join(' ').trim();
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
			name: JSON.stringify(name),
			tags: ['0-99'],
			import: JSON.stringify('.' + genSuffix + '/' + d + '.json')
		});
	}

	let indexTemplate = `// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadImmutableLegends, type LegendSet } from "$lib/utils/legends";
${fontMeta.map((f) => `import ${f.varname}SVG from './generated/${f.varname}.svg';`).join('\n')}

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
    readonly load: () => Promise<ReturnType<typeof loadImmutableLegends>>;
}

type BuiltinID = "blanks"|"${fontMeta.map(x => x.varname).join('"|"')}";

const builtins: Record<BuiltinID, Builtin> = {
	blanks: { id: "blanks", name: "Blanks", tags: ["blank"], load: async () => blanks, preview: "" } as Builtin,
${fontMeta
			.map((x) => {
				return (
					'    ' +
					x.varname +
					': { id: "' + x.varname +
					'", name: ' + x.name +
					', tags: ' + JSON.stringify(x.tags) +
					', preview: ' + x.varname + 'SVG' +
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
