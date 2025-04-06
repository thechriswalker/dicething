// we should be able to use filesystem calls here and $lib functions
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';

import { createSetFromFont } from '$lib/utils/font';
import { dirname } from 'node:path';

import { DOMParser } from 'xmldom';

// patch this into global
globalThis.DOMParser = DOMParser;

async function createFontBasedLegends(src: string, dst: string) {
	// load font from src.
	const data = (await readFile(src)).buffer;

	const set = createSetFromFont(data);
	// write set to disk
	await writeFile(dst, JSON.stringify(set), { encoding: 'utf8' });
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

	const fontMeta = [];
	for (let d of await readdir(builtins)) {
		const src = builtins + '/' + d + '/' + d + '.ttf';
		const dst = generated + '/' + d + '.json';
		await createFontBasedLegends(src, dst);
		fontMeta.push({
			name: d,
			import: JSON.stringify('.' + genSuffix + '/' + d + '.json')
		});
	}

	let indexTemplate = `// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadLegends } from "$lib/utils/legends";
`;
	fontMeta.forEach((f) => {
		indexTemplate += 'import ' + f.name + ' from ' + f.import + ';\n';
	});
	indexTemplate += `const fonts = {\n`;
	fontMeta.forEach((f) => {
		indexTemplate += '  ' + f.name + ': loadLegends(' + f.name + '),\n';
	});
	indexTemplate += `} as const;

export default fonts;
`;

	await writeFile(baseDir + '/index.ts', indexTemplate, { encoding: 'utf8' });
}

buildAll().catch((e) => console.error(e));
