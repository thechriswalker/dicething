// Main-thread client for the box worker. Wraps the postMessage dance in a
// promise keyed by a monotonic request id, streams progress ticks to an
// optional callback, and rehydrates the flattened result back into live
// three.js objects. Falls back to a synchronous in-thread build when there is
// no worker (SSR / tests).
//
// Stale-result handling is the caller's job: each call gets a fresh reqId, and a
// rapidly-changing config (debounced upstream) can leave an older build still
// running. The promise still resolves; the caller should ignore results it no
// longer wants (see the boxes page, which tracks the latest reqId).

import { browser } from '$app/environment';
import BoxWorker from './box.worker?worker';
import { diceToJSON, type DiceSet } from '$lib/interfaces/storage.svelte';
import {
	buildBox,
	prepareLayout,
	type BuiltBox,
	type PreparedLayout,
	type ProgressCallback
} from './box_builder';
import { rehydrateBuiltBox, rehydratePreparedLayout } from './serialize';
import type { BoxConfig } from './types';
import type { BoxResponse } from './box_protocol';

type Pending = {
	resolve: (value: BuiltBox | PreparedLayout) => void;
	reject: (error: unknown) => void;
	onProgress?: ProgressCallback;
};

let worker: Worker | undefined;
const pending = new Map<number, Pending>();
let nextReqId = 1;

function getWorker(): Worker | undefined {
	if (!browser) {
		return undefined;
	}
	if (!worker) {
		worker = new BoxWorker({ name: 'box-worker' });
		worker.addEventListener('message', (event: MessageEvent<BoxResponse>) => {
			const msg = event.data;
			const p = pending.get(msg.reqId);
			if (!p) {
				return;
			}
			if (msg.type === 'progress') {
				p.onProgress?.(msg.progress);
				return;
			}
			pending.delete(msg.reqId);
			if (msg.type === 'error') {
				p.reject(new Error(msg.error));
			} else if (msg.kind === 'build') {
				p.resolve(rehydrateBuiltBox(msg.result));
			} else {
				p.resolve(rehydratePreparedLayout(msg.result));
			}
		});
	}
	return worker;
}

function dispatch(
	kind: 'build' | 'layout',
	set: DiceSet,
	config: BoxConfig,
	onProgress?: ProgressCallback
): Promise<BuiltBox | PreparedLayout> {
	const w = getWorker();
	if (!w) {
		// no worker (SSR / tests): build synchronously in-thread. The builders
		// return live three.js objects directly, so no rehydrate is needed.
		return kind === 'build'
			? buildBox(set, config, onProgress)
			: prepareLayout(set, config, onProgress);
	}
	const reqId = nextReqId++;
	return new Promise((resolve, reject) => {
		pending.set(reqId, { resolve, reject, onProgress });
		w.postMessage({
			reqId,
			kind,
			dice: diceToJSON(set.dice),
			config: JSON.stringify(config)
		});
	});
}

export function buildBoxInWorker(
	set: DiceSet,
	config: BoxConfig,
	onProgress?: ProgressCallback
): Promise<BuiltBox> {
	return dispatch('build', set, config, onProgress) as Promise<BuiltBox>;
}

export function prepareLayoutInWorker(
	set: DiceSet,
	config: BoxConfig,
	onProgress?: ProgressCallback
): Promise<PreparedLayout> {
	return dispatch('layout', set, config, onProgress) as Promise<PreparedLayout>;
}

// During dev, the worker is a long-lived singleton running the code it was built
// with; editing the builder won't take effect until it is recreated. Tear it
// down on HMR so a hot update picks up the new worker bundle.
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		worker?.terminate();
		worker = undefined;
		pending.clear();
	});
}
