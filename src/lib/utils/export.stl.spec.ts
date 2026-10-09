import { describe, it, expect } from 'vitest';
import { BoxGeometry, Mesh, MeshNormalMaterial, Shape, Vector2 } from 'three';
import { unzipSync } from 'fflate';
import { geometryToManifold, manifoldToGeometry } from './manifold';
import { buildPlatform } from './build_options/platforms';
import { checkMesh } from './mesh_check';
import {
	exportStlSingle,
	exportStlZip,
	flatPositionsToStlBinary,
	manifoldToFlatPositions,
	stlBinaryToFlatPositions,
	type NamedMesh
} from './export';

function pentagon(radius: number): Shape {
	const pts: Array<Vector2> = [];
	for (let k = 0; k < 5; k++) {
		const a = (k * 2 * Math.PI) / 5;
		pts.push(new Vector2(radius * Math.cos(a), radius * Math.sin(a)));
	}
	return new Shape(pts);
}

const platform = { inset: 0.5, height: 2, outset: 1 };

describe('Manifold-backed STL export', () => {
	it('binary STL round-trips flat positions bit-identically', () => {
		const man = geometryToManifold(new BoxGeometry(10, 10, 10));
		const flat = manifoldToFlatPositions(man, 'y');
		man.delete();
		const bytes = flatPositionsToStlBinary(flat);
		expect(stlBinaryToFlatPositions(bytes)).toEqual(flat);
	});

	it('STL expanded from Manifold indexed verts stays watertight & manifold', () => {
		const man = geometryToManifold(new BoxGeometry(10, 10, 10));
		const flat = manifoldToFlatPositions(man, 'y');
		man.delete();
		const report = checkMesh(stlBinaryToFlatPositions(flatPositionsToStlBinary(flat)));
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.isPrintable).toBe(true);
		expect(report.degenerateTriangleCount).toBe(0);
	});

	it('exportStlSingle prefers Manifold over the display mesh soup', async () => {
		const man = geometryToManifold(buildPlatform(pentagon(10), platform));
		const preview = new Mesh(manifoldToGeometry(man), new MeshNormalMaterial());
		const named: NamedMesh = { name: 'platform', mesh: preview, group: 'platforms', manifold: man };
		const blob = exportStlSingle([named], 'y');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const report = checkMesh(stlBinaryToFlatPositions(bytes));
		man.delete();
		preview.geometry.dispose();
		expect(report.isPrintable).toBe(true);
	});

	it('export without a live Manifold still re-welds via geometryToIndexedMesh', async () => {
		const geo = buildPlatform(pentagon(8), platform);
		// Display path: non-indexed with per-triangle normals — the historical
		// STLExporter input. Export must NOT dump this soup raw.
		const display = manifoldToGeometry(geometryToManifold(geo));
		const named: NamedMesh = {
			name: 'platform',
			mesh: new Mesh(display, new MeshNormalMaterial()),
			group: 'platforms'
		};
		const blob = exportStlSingle([named], 'z');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const report = checkMesh(stlBinaryToFlatPositions(bytes));
		display.dispose();
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.isPrintable).toBe(true);
	});

	it('exportStlZip emits one printable .stl per mesh', async () => {
		const mats = new MeshNormalMaterial();
		const named: Array<NamedMesh> = [10, 8].map((r, i) => {
			const man = geometryToManifold(buildPlatform(pentagon(r), platform));
			return {
				name: `part_${i}`,
				mesh: new Mesh(manifoldToGeometry(man), mats),
				group: 'platforms',
				manifold: man
			};
		});
		const blob = exportStlZip(named, 'z');
		const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		expect(Object.keys(files)).toContain('part_0.stl');
		expect(Object.keys(files)).toContain('part_1.stl');
		for (const n of named) {
			const report = checkMesh(stlBinaryToFlatPositions(files[`${n.name}.stl`]));
			expect(report.isPrintable, n.name).toBe(true);
			n.manifold?.delete();
			n.mesh.geometry.dispose();
		}
	});
});
