// Runs the (potentially expensive) mesh structural analysis off the main
// thread. The caller transfers a non-indexed position buffer in and gets a
// `MeshCheckReport` back, correlated by `id`. No three.js / DOM is loaded here:
// checkMesh works on a raw number buffer, so this worker stays tiny.
import { checkMesh, type MeshCheckOptions } from './mesh_check';

type Request = {
	id: string;
	positions: Float32Array;
	options?: MeshCheckOptions;
};

self.onmessage = (event: MessageEvent<Request>) => {
	const { id, positions, options } = event.data;
	try {
		const report = checkMesh(positions, options ?? {});
		postMessage({ id, report });
	} catch (error) {
		postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
};
