// Thin adapter around manifold-3d (a WASM port of the Manifold geometry kernel).
//
// We use Manifold for CSG (die engraving, box cavities, platform offsets) and
// indexed 3MF export. Manifold guarantees watertight, 2-manifold, degenerate-free
// output, which is exactly the export goal the rest of this codebase works hard
// to hold.
//
// WASM is initialised once in ./manifold_wasm (top-level await). Import anything
// from this file and the binding is ready; do not import manifold-3d directly.
//
// Two awkward facts shape the geometry helpers:
//   1. WASM has no GC. Every Manifold instance MUST be `.delete()`d. Callers own
//      the Manifolds they create; the helpers here only delete the temporaries
//      they create internally.
//   2. Manifold requires *topologically* manifold input (shared vertices along
//      every edge). Our die solids are only *geometrically* watertight: their
//      hard-edge seams are deliberately left as duplicate vertices (mergeVertices
//      keeps them split because the normals differ). So before handing a three
//      BufferGeometry to Manifold we weld by POSITION ONLY (stripping normals so
//      mergeVertices can collapse the seams), then let Mesh.merge() stitch any
//      remaining within-tolerance gaps.

import {
	BufferAttribute,
	BufferGeometry,
	Float32BufferAttribute,
	type Mesh as ThreeMesh
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import wasm from './manifold_wasm';
import type { Manifold, ManifoldToplevel, ManifoldMesh } from './manifold_wasm';

export { default as wasm } from './manifold_wasm';
export type { CrossSection, Manifold, ManifoldToplevel, Mat4, ManifoldMesh } from './manifold_wasm';

// Ready immediately (manifold_wasm top-level await completed before this module
// runs). Kept for callers that already await init at a boundary.
export function getManifold(): Promise<ManifoldToplevel> {
	return Promise.resolve(wasm);
}

export function manifold(): ManifoldToplevel {
	return wasm;
}

// Deep copy via mesh round-trip. Use when a pipeline needs an owned Manifold
// (caller will .delete()) but the source is borrowed (e.g. blankCache).
export function cloneManifold(man: Manifold): Manifold {
	return new wasm.Manifold(man.getMesh());
}

// mesh_check welds coincident corners on a 1e-4 mm grid. Manifold's working
// tolerance can be finer, so CSG output may keep edges shorter than that weld
// which then read as "degenerate triangles" (and, once those tris are excluded
// from edge counts, as false open boundaries). Simplifying just above the weld
// grid collapses those short edges; surfaces move by less than the tolerance
// and real features are untouched. Same rationale as box_builder's clean pass.
export const MESH_CHECK_WELD_TOLERANCE = 1e-4;
export const MANIFOLD_CLEAN_TOLERANCE = 3e-4;

// Collapse micro-edges, take ownership of `man` (deleted), return the cleaned copy.
export function simplifyForMeshCheck(man: Manifold): Manifold {
	const cleaned = man.simplify(MANIFOLD_CLEAN_TOLERANCE);
	man.delete();
	return cleaned;
}

// Convert a three BufferGeometry into a Manifold. Welds vertices by position
// first (see file header). The caller owns the returned Manifold and must
// `.delete()` it.
export function geometryToManifold(geometry: BufferGeometry): Manifold {
	// strip everything but position so mergeVertices welds purely on geometry,
	// collapsing the hard-edge seams a die mesh keeps split by normal.
	const positionOnly = new BufferGeometry();
	const srcPos = geometry.getAttribute('position');
	positionOnly.setAttribute('position', srcPos.clone());
	if (geometry.index) {
		positionOnly.setIndex(geometry.index.clone());
	}
	const welded = mergeVertices(positionOnly);
	const pos = welded.getAttribute('position');
	const index = welded.index;
	if (!index) {
		throw new Error('mergeVertices did not produce an indexed geometry');
	}

	const vertProperties = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		vertProperties[i * 3] = pos.getX(i);
		vertProperties[i * 3 + 1] = pos.getY(i);
		vertProperties[i * 3 + 2] = pos.getZ(i);
	}
	const triVerts = new Uint32Array(index.array);

	const mesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
	// best-effort stitch of any remaining within-tolerance open edges so ofMesh
	// gets a clean 2-manifold.
	mesh.merge();
	const man = wasm.Manifold.ofMesh(mesh);
	const status = man.status();
	if (status !== 'NoError') {
		console.warn('geometryToManifold: non-manifold input ->', status);
	}
	return man;
}

// Convert a Manifold back to three BufferGeometry with per-triangle normals.
// Manifold welds coplanar regions down to few big triangles; splitting to
// non-indexed before computeVertexNormals keeps flat faces from looking curved
// under MeshNormalMaterial (shared corner verts would otherwise average crease
// normals across the whole face). Does NOT delete the Manifold (caller owns it).
export function manifoldToGeometry(man: Manifold): BufferGeometry {
	const mesh: ManifoldMesh = man.getMesh();
	const geo = new BufferGeometry();
	// numProp is always >= 3 with x,y,z first; for our property-less solids it is
	// exactly 3, so vertProperties is a plain xyz buffer.
	const numProp = mesh.numProp;
	if (numProp === 3) {
		geo.setAttribute('position', new Float32BufferAttribute(mesh.vertProperties, 3));
	} else {
		const count = mesh.vertProperties.length / numProp;
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = mesh.vertProperties[i * numProp];
			positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
			positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
		}
		geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
	}
	geo.setIndex(new BufferAttribute(mesh.triVerts, 1));
	const flat = geo.toNonIndexed();
	geo.dispose();
	flat.computeVertexNormals();
	return flat;
}

// A welded, indexed triangle mesh: a plain xyz vertex buffer plus triangle
// indices into it. This is the natural input for an indexed solid format like
// 3MF (one vertex shared by every triangle that touches it), as opposed to the
// flat 9-floats-per-triangle form an STL wants.
export type IndexedMesh = { positions: Float32Array; indices: Uint32Array };

function meshGlToIndexedMesh(mesh: ManifoldMesh): IndexedMesh | undefined {
	const numProp = mesh.numProp;
	const vertCount = numProp > 0 ? mesh.vertProperties.length / numProp : 0;
	if (mesh.triVerts.length === 0 || vertCount === 0) {
		return undefined;
	}
	let positions: Float32Array;
	if (numProp === 3) {
		positions = new Float32Array(mesh.vertProperties);
	} else {
		positions = new Float32Array(vertCount * 3);
		for (let i = 0; i < vertCount; i++) {
			positions[i * 3] = mesh.vertProperties[i * numProp];
			positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
			positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
		}
	}
	return { positions, indices: new Uint32Array(mesh.triVerts) };
}

// Copy a Manifold's mesh into indexed form for 3MF export. Does NOT delete the
// Manifold (caller owns it). Prefer this over geometryToIndexedMesh when the
// solid is already a Manifold so export never round-trips through Three.js.
export function manifoldToIndexedMesh(man: Manifold): IndexedMesh {
	const indexed = meshGlToIndexedMesh(man.getMesh());
	if (!indexed) {
		throw new Error('manifoldToIndexedMesh: empty Manifold mesh');
	}
	return indexed;
}

// Bridge a three BufferGeometry into the indexed mesh 3MF wants by routing it
// through Manifold: ofMesh() welds and validates topology, and getMesh() hands
// back a clean, deduplicated MeshGL (shared vertices + triVerts). This is the
// "transfer the model between three and manifold" path, and it guarantees a
// genuinely manifold solid rather than a soup that merely re-welds.
//
// The returned arrays are copies, so they survive the temporary Manifold's delete().
// If Manifold rejects the input (non-manifold) and yields an empty mesh, we fall
// back to a position-only weld of the original geometry so export still emits
// something faithful rather than nothing.
export function geometryToIndexedMesh(geometry: BufferGeometry): IndexedMesh {
	const man = geometryToManifold(geometry);
	try {
		const indexed = meshGlToIndexedMesh(man.getMesh());
		if (indexed) {
			return indexed;
		}
	} finally {
		man.delete();
	}
	return weldedIndexedMesh(geometry);
}

// Fallback for geometryToIndexedMesh: weld a geometry to an indexed mesh purely
// in three (position-only, so hard-edge seams collapse), without any manifold
// guarantee. Used only when Manifold couldn't make sense of the input.
function weldedIndexedMesh(geometry: BufferGeometry): IndexedMesh {
	const positionOnly = new BufferGeometry();
	positionOnly.setAttribute('position', geometry.getAttribute('position').clone());
	if (geometry.index) {
		positionOnly.setIndex(geometry.index.clone());
	}
	const welded = mergeVertices(positionOnly);
	const pos = welded.getAttribute('position');
	const index = welded.index;
	if (!index) {
		throw new Error('mergeVertices did not produce an indexed geometry');
	}
	const positions = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		positions[i * 3] = pos.getX(i);
		positions[i * 3 + 1] = pos.getY(i);
		positions[i * 3 + 2] = pos.getZ(i);
	}
	return { positions, indices: new Uint32Array(index.array) };
}

// Convenience: run a CSG difference (a minus each of `cutters`) and return the
// result geometry. Deletes every Manifold it touches, including the inputs, so
// callers can pass freshly-built solids and not worry about leaks.
export function differenceGeometry(base: Manifold, cutters: Array<Manifold>): BufferGeometry {
	let result = base;
	if (cutters.length > 0) {
		const cut = wasm.Manifold.union(cutters);
		const diff = wasm.Manifold.difference(base, cut);
		cut.delete();
		base.delete();
		cutters.forEach((c) => c.delete());
		result = diff;
	}
	const geo = manifoldToGeometry(result);
	result.delete();
	return geo;
}

// Delete a batch of Manifolds, tolerating undefined entries.
export function deleteAll(...mans: Array<Manifold | undefined>): void {
	for (const m of mans) {
		m?.delete();
	}
}

// Extract a flat, NON-INDEXED position buffer (9 numbers per triangle) from a
// three mesh/geometry, matching what mesh_check / an STL expects.
export function toFlatPositions(meshOrGeo: ThreeMesh | BufferGeometry): Float32Array {
	const geometry = (meshOrGeo as ThreeMesh).isMesh
		? (meshOrGeo as ThreeMesh).geometry
		: (meshOrGeo as BufferGeometry);
	const geo = geometry.index ? geometry.toNonIndexed() : geometry;
	const pos = geo.getAttribute('position');
	const out = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		out[i * 3] = pos.getX(i);
		out[i * 3 + 1] = pos.getY(i);
		out[i * 3 + 2] = pos.getZ(i);
	}
	return out;
}
