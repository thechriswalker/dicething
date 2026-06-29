// Thin adapter around manifold-3d (a WASM port of the Manifold geometry kernel).
//
// We use Manifold for the box builder's CSG: subtracting die-shaped cavities and
// magnet bores from a parametric shell. Manifold's whole selling point is that it
// guarantees *manifold* (watertight, 2-manifold, degenerate-free) output, which
// is exactly the export goal the rest of this codebase works so hard to hold.
//
// Two awkward facts shape this file:
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
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel, Mesh as ManifoldMesh } from 'manifold-3d';

let _wasm: ManifoldToplevel | undefined;
let _initPromise: Promise<ManifoldToplevel> | undefined;

// Are we running outside a browser (i.e. in node, e.g. the vitest `server`
// project)? In node the emscripten module locates its own .wasm beside the .js,
// so we must NOT pass a `locateFile`; in the browser we resolve the asset URL via
// Vite's `?url` import. We key off `window` rather than `process` because the
// jsdom test environments define `process` too. A web worker has no `window` but
// is still a browser context that needs the Vite-resolved `?url` (otherwise the
// emscripten loader 404s on the .wasm), so treat a WorkerGlobalScope as browser.
const workerScope = (globalThis as { WorkerGlobalScope?: new () => object }).WorkerGlobalScope;
const isWorker =
	typeof workerScope !== 'undefined' && typeof self !== 'undefined' && self instanceof workerScope;
const isBrowser = typeof window !== 'undefined' || isWorker;

// Initialise (once) and return the Manifold WASM toplevel. Safe to call
// concurrently; all callers await the same in-flight init.
export async function getManifold(): Promise<ManifoldToplevel> {
	if (_wasm) {
		return _wasm;
	}
	if (!_initPromise) {
		_initPromise = (async () => {
			let wasm: ManifoldToplevel;
			if (isBrowser) {
				// Vite needs the wasm asset URL wired up explicitly, otherwise the
				// emscripten loader 404s looking for it next to the bundled chunk.
				const { default: wasmUrl } = await import('manifold-3d/manifold.wasm?url');
				wasm = await Module({ locateFile: () => wasmUrl });
			} else {
				wasm = await Module();
			}
			wasm.setup();
			_wasm = wasm;
			return wasm;
		})();
	}
	return _initPromise;
}

// Synchronous accessor for code paths that already know init has completed (e.g.
// inside a builder run that awaited getManifold() up front). Throws if called
// before initialisation.
export function manifold(): ManifoldToplevel {
	if (!_wasm) {
		throw new Error('Manifold WASM not initialised; await getManifold() first');
	}
	return _wasm;
}

// Convert a three BufferGeometry into a Manifold. Welds vertices by position
// first (see file header). The caller owns the returned Manifold and must
// `.delete()` it.
export function geometryToManifold(geometry: BufferGeometry): Manifold {
	const wasm = manifold();
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

// Convert a Manifold back to an (indexed) three BufferGeometry with recomputed
// flat-ish vertex normals. Does NOT delete the Manifold (the caller owns it).
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
	geo.computeVertexNormals();
	return geo;
}

// Convenience: run a CSG difference (a minus each of `cutters`) and return the
// result geometry. Deletes every Manifold it touches, including the inputs, so
// callers can pass freshly-built solids and not worry about leaks.
export function differenceGeometry(base: Manifold, cutters: Array<Manifold>): BufferGeometry {
	const wasm = manifold();
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
