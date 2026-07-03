import { describe, it, expect, beforeAll } from 'vitest';
import { Shape, Vector2 } from 'three';
import { unzipSync, strFromU8 } from 'fflate';
import { getManifold, geometryToIndexedMesh } from './manifold';
import {
	buildThreeMf,
	buildThreeMfGrouped,
	buildThreeMfZip,
	groupedModelXml,
	modelXml,
	BAMBU_MAGNET_PAUSE_FILE,
	PRUSA_MAGNET_PAUSE_FILE,
	bambuMagnetPauseXml,
	prusaMagnetPauseXml,
	type UpAxis
} from './threemf';
import { buildPlatform } from './build_options/platforms';
import { checkMesh } from './mesh_check';

// A few watertight source solids to push through the manifold -> 3MF path.
// buildPlatform yields a closed solid without needing a full Builder/legend set.
function pentagon(radius: number): Shape {
	const pts: Array<Vector2> = [];
	for (let k = 0; k < 5; k++) {
		const a = (k * 2 * Math.PI) / 5;
		pts.push(new Vector2(radius * Math.cos(a), radius * Math.sin(a)));
	}
	return new Shape(pts);
}

function plus(arm: number, half: number): Shape {
	return new Shape([
		new Vector2(-half, -arm),
		new Vector2(half, -arm),
		new Vector2(half, -half),
		new Vector2(arm, -half),
		new Vector2(arm, half),
		new Vector2(half, half),
		new Vector2(half, arm),
		new Vector2(-half, arm),
		new Vector2(-half, half),
		new Vector2(-arm, half),
		new Vector2(-arm, -half),
		new Vector2(-half, -half)
	]);
}

// Expand an indexed mesh (as the 3MF model XML stores it) into the flat,
// 9-floats-per-triangle buffer mesh_check wants, applying the same up-axis
// conversion the writer applies. This validates the actual exported coordinates.
function flatFromModelXml(xml: string): Float32Array {
	const verts: Array<[number, number, number]> = [];
	for (const m of xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)) {
		verts.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
	}
	const tris: Array<[number, number, number]> = [];
	for (const m of xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)) {
		tris.push([Number(m[1]), Number(m[2]), Number(m[3])]);
	}
	const out = new Float32Array(tris.length * 9);
	let o = 0;
	for (const [a, b, c] of tris) {
		for (const idx of [a, b, c]) {
			out[o++] = verts[idx][0];
			out[o++] = verts[idx][1];
			out[o++] = verts[idx][2];
		}
	}
	return out;
}

const platform = { height: 2, inset: 1.5, outset: 1.5 };

beforeAll(async () => {
	await getManifold();
});

describe('manifold -> 3MF export pipeline', () => {
	it('geometryToIndexedMesh produces a non-empty indexed mesh', () => {
		const geo = buildPlatform(pentagon(10), platform);
		const { positions, indices } = geometryToIndexedMesh(geo);
		expect(positions.length).toBeGreaterThan(0);
		expect(positions.length % 3).toBe(0);
		expect(indices.length).toBeGreaterThan(0);
		expect(indices.length % 3).toBe(0);
		// every index must point at a real vertex.
		const vertCount = positions.length / 3;
		for (const i of indices) {
			expect(i).toBeLessThan(vertCount);
		}
	});

	it.each<UpAxis>(['y', 'z'])(
		'exported model XML stays watertight & manifold (up=%s)',
		(upAxis) => {
			for (const shape of [pentagon(10), plus(10, 4)]) {
				const geo = buildPlatform(shape, platform);
				const indexed = geometryToIndexedMesh(geo);
				const xml = modelXml([{ name: 'part', ...indexed }], upAxis);
				const report = checkMesh(flatFromModelXml(xml));
				expect(report.boundaryEdgeCount).toBe(0);
				expect(report.nonManifoldEdgeCount).toBe(0);
				expect(report.isWatertight).toBe(true);
				expect(report.isManifold).toBe(true);
			}
		}
	);

	it('buildThreeMf packages a valid OPC container with one object per mesh', async () => {
		const indexed = [pentagon(10), plus(10, 4)].map((s) =>
			geometryToIndexedMesh(buildPlatform(s, platform))
		);
		const blob = buildThreeMf(
			indexed.map((m, i) => ({ name: `part_${i}`, ...m })),
			'y'
		);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const files = unzipSync(bytes);
		expect(Object.keys(files)).toContain('[Content_Types].xml');
		expect(Object.keys(files)).toContain('_rels/.rels');
		expect(Object.keys(files)).toContain('3D/3dmodel.model');
		const model = strFromU8(files['3D/3dmodel.model']);
		expect(model).toContain('unit="millimeter"');
		expect(model).toContain('http://schemas.microsoft.com/3dmanufacturing/core/2015/02');
		// both meshes present as separate objects, each placed in the build.
		expect((model.match(/<object /g) ?? []).length).toBe(2);
		expect((model.match(/<item /g) ?? []).length).toBe(2);
	});

	it('groups meshes into one component object with a single build item', async () => {
		const objects = [pentagon(10), plus(10, 4)].map((s, i) => ({
			name: `box_part_${i}`,
			...geometryToIndexedMesh(buildPlatform(s, platform))
		}));
		const xml = groupedModelXml([{ name: 'box', objects }], 'z');
		// two child mesh objects + one wrapper component object = three objects,
		// but only the wrapper is placed in the build.
		expect((xml.match(/<object /g) ?? []).length).toBe(3);
		expect((xml.match(/<components>/g) ?? []).length).toBe(1);
		expect((xml.match(/<component /g) ?? []).length).toBe(2);
		expect((xml.match(/<item /g) ?? []).length).toBe(1);
		// the build item targets the wrapper (the highest object id), and the
		// components reference the two child mesh objects.
		expect(xml).toContain('<item objectid="3"/>');
		expect(xml).toContain('<component objectid="1"/>');
		expect(xml).toContain('<component objectid="2"/>');
		expect(xml).toContain('name="box"');

		// the grouped package is still a valid OPC container.
		const blob = buildThreeMfGrouped([{ name: 'box', objects }], 'z');
		const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		expect(Object.keys(files)).toContain('3D/3dmodel.model');
	});

	it('buildThreeMfZip emits one .3mf per mesh', async () => {
		const indexed = [pentagon(10), plus(10, 4)].map((s) =>
			geometryToIndexedMesh(buildPlatform(s, platform))
		);
		const blob = buildThreeMfZip(
			indexed.map((m, i) => ({ name: `part_${i}`, ...m })),
			'z'
		);
		const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		const names = Object.keys(files);
		expect(names).toContain('part_0.3mf');
		expect(names).toContain('part_1.3mf');
		// each entry is itself a valid 3MF package.
		const inner = unzipSync(files['part_0.3mf']);
		expect(Object.keys(inner)).toContain('3D/3dmodel.model');
	});

	it('embeds Prusa and Bambu magnet-pause metadata when magnetPauseZ is set', async () => {
		const indexed = geometryToIndexedMesh(buildPlatform(pentagon(10), platform));
		const pauseZ = 12.34567;
		const blob = buildThreeMfGrouped([{ name: 'box', objects: [{ name: 'base', ...indexed }] }], 'z', pauseZ);
		const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		expect(Object.keys(files)).toContain(PRUSA_MAGNET_PAUSE_FILE);
		expect(Object.keys(files)).toContain(BAMBU_MAGNET_PAUSE_FILE);
		const prusa = strFromU8(files[PRUSA_MAGNET_PAUSE_FILE]);
		const bambu = strFromU8(files[BAMBU_MAGNET_PAUSE_FILE]);
		expect(prusa).toContain('print_z="12.34567"');
		expect(prusa).toContain('type="1"');
		expect(bambu).toContain('top_z="12.34567"');
		expect(bambu).toContain('type="1"');
	});

	it('magnet pause XML matches slicer schemas', () => {
		expect(prusaMagnetPauseXml(10)).toBe(
			'<?xml version="1.0" encoding="UTF-8"?>\n' +
				'<custom_gcodes_per_print_z bed_idx="0">\n' +
				'<code print_z="10" type="1" extruder="0" color="" extra="" gcode="M601"/>\n' +
				'<mode value="SingleExtruder"/>\n' +
				'</custom_gcodes_per_print_z>\n'
		);
		expect(bambuMagnetPauseXml(10)).toContain('<layer top_z="10" type="1"');
	});
});
