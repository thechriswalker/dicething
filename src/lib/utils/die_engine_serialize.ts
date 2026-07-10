// Flatten / rehydrate die geometries for export across the worker boundary.
import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three';
import type { SerialisedEngineGeometry, SerialisedExportMesh } from './die_engine_protocol';

export function geometryToEngineBuffers(geo: BufferGeometry): SerialisedEngineGeometry {
	const pos = geo.getAttribute('position');
	const position = Float32Array.from(pos.array as ArrayLike<number>);
	const idx = geo.index;
	const index = idx ? Uint32Array.from(idx.array as ArrayLike<number>) : undefined;
	return { position, index };
}

export function engineBuffersToGeometry(buf: SerialisedEngineGeometry): BufferGeometry {
	const geo = new BufferGeometry();
	geo.setAttribute('position', new Float32BufferAttribute(buf.position, 3));
	if (buf.index) {
		geo.setIndex(new BufferAttribute(buf.index, 1));
	}
	geo.computeVertexNormals();
	return geo;
}

export function exportMeshTransferables(
	meshes: Array<SerialisedExportMesh>
): { meshes: Array<SerialisedExportMesh>; transfer: Array<ArrayBuffer> } {
	const transfer: Array<ArrayBuffer> = [];
	for (const m of meshes) {
		transfer.push(m.geometry.position.buffer as ArrayBuffer);
		if (m.geometry.index) {
			transfer.push(m.geometry.index.buffer as ArrayBuffer);
		}
	}
	return { meshes, transfer };
}
