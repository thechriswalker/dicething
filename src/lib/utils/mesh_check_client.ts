// Main-thread client for the mesh-check worker. Wraps the postMessage dance in
// a promise keyed by a request id, and transfers a copy of the position buffer
// so the caller's geometry stays intact. Falls back to a synchronous in-thread
// check when there is no worker (SSR / tests).
import { browser } from '$app/environment';
import MeshCheckWorker from './mesh-check.worker?worker';
import { checkMesh, type MeshCheckOptions, type MeshCheckReport } from './mesh_check';
import { uuid } from './uuid';

type Pending = {
	resolve: (report: MeshCheckReport) => void;
	reject: (error: unknown) => void;
};

let worker: Worker | undefined;
const pending = new Map<string, Pending>();

function getWorker(): Worker | undefined {
	if (!browser) {
		return undefined;
	}
	if (!worker) {
		worker = new MeshCheckWorker({ name: 'mesh-check-worker' });
		worker.addEventListener('message', (event: MessageEvent) => {
			const { id, report, error } = event.data ?? {};
			const p = pending.get(id);
			if (!p) {
				return;
			}
			pending.delete(id);
			if (error) {
				p.reject(new Error(String(error)));
			} else {
				p.resolve(report);
			}
		});
	}
	return worker;
}

// Check a non-indexed position buffer (9 numbers per triangle) for manifold /
// watertight / degenerate problems, off the main thread when possible.
export function checkMeshInWorker(
	positions: ArrayLike<number>,
	options: MeshCheckOptions = {}
): Promise<MeshCheckReport> {
	const w = getWorker();
	if (!w) {
		return Promise.resolve(checkMesh(positions, options));
	}
	// transfer a copy so the source geometry's buffer isn't detached.
	const copy = Float32Array.from(positions);
	const id = uuid();
	return new Promise<MeshCheckReport>((resolve, reject) => {
		pending.set(id, { resolve, reject });
		w.postMessage({ id, positions: copy, options }, [copy.buffer]);
	});
}
