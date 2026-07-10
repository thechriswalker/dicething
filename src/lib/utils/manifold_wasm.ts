// One-time Manifold WASM initialisation via top-level await. Every consumer
// imports this module (directly or through ./manifold) and gets a ready wasm
// binding; nobody else should import manifold-3d.
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

const workerScope = (globalThis as { WorkerGlobalScope?: new () => object }).WorkerGlobalScope;
const isWorker =
	typeof workerScope !== 'undefined' && typeof self !== 'undefined' && self instanceof workerScope;
const isBrowser = typeof window !== 'undefined' || isWorker;

let wasm: ManifoldToplevel;
if (isBrowser) {
	const { default: wasmUrl } = await import('manifold-3d/manifold.wasm?url');
	wasm = await Module({ locateFile: () => wasmUrl });
} else {
	wasm = await Module();
}
wasm.setup();

export default wasm;

export type {
	CrossSection,
	Manifold,
	ManifoldToplevel,
	Mat4,
	Mesh as ManifoldMesh
} from 'manifold-3d';
