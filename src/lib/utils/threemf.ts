// 3MF writer.
//
// 3MF is an OPC (Open Packaging Conventions) package: a ZIP containing an XML
// content-types manifest, a relationships part, and the model XML itself. Unlike
// STL it stores an *indexed* mesh (shared vertices + triangle indices), which is
// exactly what Manifold hands us via geometryToIndexedMesh() and the format the
// 3MF spec was designed around for watertight solids. We build the ZIP with
// fflate (already used for the STL bundles).
//
// Coordinate frame: three.js / our die builder work Y-up, but 3MF (and the
// slicers that read it) treat Z as up with the model resting on the XY build
// plate. So a Y-up source is rotated +90deg about X — (x,y,z) -> (x,-z,y) — a
// pure rotation (det +1) that preserves triangle winding (3MF needs CCW-from-
// outside). Box geometry is already built Z-up, so it passes through untouched.

import { zipSync, type Zippable } from 'fflate';
import type { IndexedMesh } from './manifold';

export type UpAxis = 'y' | 'z';

export type ThreeMfObject = IndexedMesh & { name: string };

// Round to micrometre precision and strip trailing zeros. Values are in mm and
// never near the exponent range, so toString() stays in plain decimal notation.
function fmt(n: number): string {
	const r = Math.round(n * 1e5) / 1e5;
	// avoid "-0".
	return (r === 0 ? 0 : r).toString();
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
	<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
	<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
	<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

// Emit one <object> (id starts at 1) carrying an indexed mesh, applying the
// up-axis conversion to every vertex.
function objectXml(obj: ThreeMfObject, id: number, upAxis: UpAxis): string {
	const { positions, indices, name } = obj;
	const vertCount = positions.length / 3;
	const verts: Array<string> = [];
	for (let i = 0; i < vertCount; i++) {
		const x = positions[i * 3];
		const y = positions[i * 3 + 1];
		const z = positions[i * 3 + 2];
		if (upAxis === 'y') {
			verts.push(`<vertex x="${fmt(x)}" y="${fmt(-z)}" z="${fmt(y)}"/>`);
		} else {
			verts.push(`<vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`);
		}
	}
	const tris: Array<string> = [];
	for (let i = 0; i < indices.length; i += 3) {
		tris.push(`<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>`);
	}
	return (
		`\t\t<object id="${id}" type="model" name="${escapeAttr(name)}">\n` +
		`\t\t\t<mesh>\n` +
		`\t\t\t\t<vertices>${verts.join('')}</vertices>\n` +
		`\t\t\t\t<triangles>${tris.join('')}</triangles>\n` +
		`\t\t\t</mesh>\n` +
		`\t\t</object>\n`
	);
}

// The 3D/3dmodel.model XML for a set of objects, each placed once in the build.
export function modelXml(objects: Array<ThreeMfObject>, upAxis: UpAxis): string {
	let resources = '';
	let items = '';
	objects.forEach((obj, idx) => {
		const id = idx + 1;
		resources += objectXml(obj, id, upAxis);
		items += `\t\t<item objectid="${id}"/>\n`;
	});
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
		`\t<metadata name="Application">dicething</metadata>\n` +
		`\t<resources>\n${resources}\t</resources>\n` +
		`\t<build>\n${items}\t</build>\n` +
		`</model>\n`
	);
}

const _enc = new TextEncoder();

// Assemble a single .3mf package from the given model XML.
function pack(model: string): Uint8Array {
	const files: Zippable = {
		'[Content_Types].xml': _enc.encode(CONTENT_TYPES),
		'_rels/.rels': _enc.encode(RELS),
		'3D/3dmodel.model': _enc.encode(model)
	};
	return zipSync(files);
}

// One .3mf containing every object (placed in a single build). The natural form
// for "all in one file" since 3MF holds multiple objects directly.
export function buildThreeMf(objects: Array<ThreeMfObject>, upAxis: UpAxis): Blob {
	const bytes = pack(modelXml(objects, upAxis));
	return new Blob([bytes as BlobPart], { type: 'model/3mf' });
}

// One .3mf per object, all packed into a ZIP (the "separate files" layout).
export function buildThreeMfZip(objects: Array<ThreeMfObject>, upAxis: UpAxis): Blob {
	const files: Zippable = {};
	const used = new Set<string>();
	for (const obj of objects) {
		let filename = `${obj.name}.3mf`;
		let i = 1;
		while (used.has(filename)) {
			filename = `${obj.name}_${i++}.3mf`;
		}
		used.add(filename);
		files[filename] = pack(modelXml([obj], upAxis));
	}
	const zipped = zipSync(files);
	return new Blob([zipped as BlobPart], { type: 'application/zip' });
}
