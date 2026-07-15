// Hard browser requirements for DiceThing. Keep the Vite `build.target` list in
// vite.config.ts aligned with whatever these checks imply.
//
// Checked early (inline classic script in app.html + root layout) so unsupported
// browsers see a clear message instead of a blank shell or a cryptic WASM/worker
// failure halfway through a session.

export type BrowserFeatureId =
	| 'webassembly'
	| 'offscreenCanvas'
	| 'transferControlToOffscreen'
	| 'moduleWorker'
	| 'webgl'
	| 'createImageBitmap';

export type BrowserFeature = {
	id: BrowserFeatureId;
	/** Short label for the unsupported-browser UI. */
	label: string;
	ok: boolean;
};

export type BrowserSupportResult = {
	ok: boolean;
	features: Array<BrowserFeature>;
	missing: Array<BrowserFeature>;
};

function hasWebAssembly(): boolean {
	return (
		typeof WebAssembly === 'object' &&
		typeof WebAssembly.instantiate === 'function' &&
		typeof WebAssembly.Module === 'function'
	);
}

function hasOffscreenCanvas(): boolean {
	return typeof OffscreenCanvas !== 'undefined';
}

function hasTransferControlToOffscreen(): boolean {
	return (
		typeof HTMLCanvasElement !== 'undefined' &&
		typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
	);
}

// Detect that `new Worker(url, { type: 'module' })` is accepted. Reading `type`
// via a getter is the sync probe; we return 'classic' so we never actually
// spawn a module worker during the check.
function hasModuleWorker(): boolean {
	if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
		return false;
	}
	let supported = false;
	try {
		const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
		try {
			const worker = new Worker(url, {
				get type() {
					supported = true;
					return 'classic';
				}
			} as WorkerOptions);
			worker.terminate();
		} finally {
			URL.revokeObjectURL(url);
		}
	} catch {
		return false;
	}
	return supported;
}

function hasWebGL(): boolean {
	try {
		if (typeof OffscreenCanvas !== 'undefined') {
			const canvas = new OffscreenCanvas(1, 1);
			const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
			if (gl) return true;
		}
	} catch {
		/* fall through to HTMLCanvasElement */
	}
	try {
		if (typeof document === 'undefined') return false;
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
		return !!gl;
	} catch {
		return false;
	}
}

function hasCreateImageBitmap(): boolean {
	return typeof createImageBitmap === 'function';
}

const checks: Array<{ id: BrowserFeatureId; label: string; test: () => boolean }> = [
	{ id: 'webassembly', label: 'WebAssembly', test: hasWebAssembly },
	{ id: 'offscreenCanvas', label: 'OffscreenCanvas', test: hasOffscreenCanvas },
	{
		id: 'transferControlToOffscreen',
		label: 'Offscreen canvas transfer',
		test: hasTransferControlToOffscreen
	},
	{ id: 'moduleWorker', label: 'ES module Web Workers', test: hasModuleWorker },
	{ id: 'webgl', label: 'WebGL', test: hasWebGL },
	{ id: 'createImageBitmap', label: 'createImageBitmap', test: hasCreateImageBitmap }
];

/** Sync feature probe. Safe to call from a classic script or during layout init. */
export function checkBrowserSupport(): BrowserSupportResult {
	const features = checks.map((c) => ({
		id: c.id,
		label: c.label,
		ok: c.test()
	}));
	const missing = features.filter((f) => !f.ok);
	return { ok: missing.length === 0, features, missing };
}
