// we should be able to use filesystem calls here and $lib functions
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';

import { createShapesFromFont } from '$lib/utils/font';
import { dirname } from 'node:path';

import { DOMParser } from 'xmldom';

const builtinPrefix = 'builtin:';

// patch this into global
globalThis.DOMParser = DOMParser;

async function createFontBasedLegends(
	src: string,
	dst: string,
	varname: string,
	name: string,
	strings?: Array<string>
) {
	// load font from src.
	const data = (await readFile(src)).buffer;

	const shapes = createShapesFromFont(data, strings);
	// write set to disk
	await writeFile(
		dst,
		JSON.stringify({
			id: builtinPrefix + varname,
			name: name,
			shapes: shapes
		}),
		{ encoding: 'utf8' }
	);
}

const zero_to_ninety_nine = Array.from({ length: 100 }).map((_, i) => {
	switch (i) {
		case 6:
			return '6.';
		case 9:
			return '9.';
		default:
			return i.toString();
	}
});

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

	const fontMeta = [];
	for (let d of await readdir(builtins)) {
		const src = builtins + '/' + d + '/' + d + '.ttf';
		let dst = generated + '/' + d + '.json';
		// un_snake_case the name.
		let name = d
			.split('_')
			.map((s) => s[0].toUpperCase() + s.slice(1))
			.join(' ');
		await createFontBasedLegends(src, dst, d, name);
		fontMeta.push({
			varname: d,
			name: JSON.stringify(name),
			import: JSON.stringify('.' + genSuffix + '/' + d + '.json')
		});
		// also make a 0-99 set, just because we can.
		d = d + '_100';
		dst = generated + '/' + d + '.json';
		name += ' (100)';
		await createFontBasedLegends(src, dst, d, name, zero_to_ninety_nine);
		fontMeta.push({
			varname: d,
			name: JSON.stringify(name),
			import: JSON.stringify('.' + genSuffix + '/' + d + '.json')
		});
	}

	let indexTemplate = `// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadImmutableLegends, type LegendSet } from "$lib/utils/legends";

const imports = {
  ${fontMeta
		.map((x) => {
			return `${x.varname}: () => import(${x.import}, {assert:{type:"json"}})`;
		})
		.join(',\n  ')}
} as const;

const deferredFontLoader = (fontname: keyof typeof imports) => {
	const fn = async () => {
		const data = await imports[fontname]();
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
    readonly name: string;
    readonly load: () => Promise<ReturnType<typeof loadImmutableLegends>>;
}

const builtins = {
	blanks: { name: "Blanks", load: async () => blanks },
${fontMeta
	.map((x) => {
		return (
			'    ' +
			x.varname +
			': { name: ' +
			x.name +
			', load: deferredFontLoader("' +
			x.varname +
			'") } as Builtin,'
		);
	})
	.join('\n')}
} as const;

export default builtins;
`;

	await writeFile(baseDir + '/index.ts', indexTemplate, { encoding: 'utf8' });
}

buildAll().catch((e) => console.error(e));
