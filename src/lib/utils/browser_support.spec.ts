import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBrowserSupport } from './browser_support';

function stubSupportedEnvironment(overrides: Record<string, unknown> = {}) {
	class FakeOffscreenCanvas {
		getContext() {
			return {};
		}
	}
	class FakeWorker {
		constructor(_url: string | URL, options?: WorkerOptions) {
			void options?.type;
		}
		terminate() {}
	}
	function FakeHTMLCanvasElement() {}
	FakeHTMLCanvasElement.prototype = {
		transferControlToOffscreen: () => ({})
	};

	const defaults: Record<string, unknown> = {
		WebAssembly: { instantiate: () => {}, Module: function Module() {} },
		OffscreenCanvas: FakeOffscreenCanvas,
		HTMLCanvasElement: FakeHTMLCanvasElement,
		Worker: FakeWorker,
		createImageBitmap: () => Promise.resolve({} as ImageBitmap),
		Blob: class FakeBlob {
			constructor(
				public parts: unknown[] = [],
				public options?: unknown
			) {}
		},
		URL: {
			createObjectURL: () => 'blob:test',
			revokeObjectURL: () => {}
		},
		...overrides
	};
	for (const [key, value] of Object.entries(defaults)) {
		vi.stubGlobal(key, value);
	}
}

describe('checkBrowserSupport', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('returns ok when all hard features are present', () => {
		stubSupportedEnvironment();
		const result = checkBrowserSupport();
		expect(result.ok).toBe(true);
		expect(result.missing).toEqual([]);
	});

	it('fails closed when WebAssembly is missing', () => {
		stubSupportedEnvironment({ WebAssembly: undefined });
		const result = checkBrowserSupport();
		expect(result.ok).toBe(false);
		expect(result.missing.map((f) => f.id)).toContain('webassembly');
	});

	it('fails closed when OffscreenCanvas is missing', () => {
		stubSupportedEnvironment({ OffscreenCanvas: undefined });
		const result = checkBrowserSupport();
		expect(result.ok).toBe(false);
		expect(result.missing.map((f) => f.id)).toContain('offscreenCanvas');
	});

	it('fails closed when module workers are unsupported', () => {
		stubSupportedEnvironment({
			Worker: class Worker {
				constructor(_url: string | URL, _options?: WorkerOptions) {
					// never reads options.type
				}
				terminate() {}
			}
		});
		const result = checkBrowserSupport();
		expect(result.ok).toBe(false);
		expect(result.missing.map((f) => f.id)).toContain('moduleWorker');
	});
});
