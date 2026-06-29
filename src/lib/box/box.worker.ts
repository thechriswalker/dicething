// Runs the heavy box build (Manifold CSG + per-die tessellation) off the main
// thread. Receives a serialised dice list + BoxConfig, runs buildBox /
// prepareLayout with a progress callback that streams `progress` messages back,
// and posts the flattened result (geometry buffers transferred zero-copy),
// correlated by `reqId`.
//
// IMPORTANT: do NOT import runtime code from storage.svelte.ts here - its
// module top-level touches `window` (a storage listener) which is undefined in
// a worker. We parse the dice JSON with a local reviver instead (mirrors
// die-previewer.worker.ts) and use type-only imports for the shared types.

// Web Workers have no DOM, so `DOMParser` (used by three's SVGLoader, which the
// custom-path coin parses through) is undefined here. Polyfill it with xmldom so
// custom coin paths build in the worker exactly as they do on the main thread.
import { DOMParser } from 'xmldom';
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'undefined') {
	(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
}

import { Vector2 } from 'three';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import { buildBox, prepareLayout, type BuildProgress } from './box_builder';
import { serializeBuiltBox, serializePreparedLayout, builtBoxTransferables } from './serialize';
import type { BoxRequest, BoxResponse } from './box_protocol';
import type { BoxConfig } from './types';

type Defined<T> = T extends undefined ? never : T;

const reviver: Defined<Parameters<typeof JSON.parse>[1]> = (key, value) => {
	if (typeof value === 'object' && value && value._ === 'v2') {
		return new Vector2(value.x, value.y);
	}
	return value;
};

// the worker's postMessage isn't typed as a DedicatedWorkerGlobalScope here
// (the DOM lib types `self` as a Window), so cast to the worker signature.
const workerPost = (
	self as unknown as {
		postMessage: (message: BoxResponse, transfer?: Array<ArrayBuffer>) => void;
	}
).postMessage.bind(self);

function post(message: BoxResponse, transfer?: Array<ArrayBuffer>) {
	workerPost(message, transfer);
}

self.onmessage = async (event: MessageEvent<BoxRequest>) => {
	const { reqId, kind, dice, config } = event.data;
	const onProgress = (progress: BuildProgress) => {
		post({ reqId, type: 'progress', progress });
	};
	try {
		const parsedDice = JSON.parse(dice, reviver) as Array<Dice>;
		// the box builder only reads `set.dice`; legends are never engraved here, so
		// a minimal set (no real LegendSet) is all that's needed.
		const set = { id: '', name: '', updated: 0, dice: parsedDice } as unknown as DiceSet;
		const cfg = JSON.parse(config) as BoxConfig;
		if (kind === 'build') {
			const built = await buildBox(set, cfg, onProgress);
			const result = serializeBuiltBox(built);
			post({ reqId, type: 'result', kind: 'build', result }, builtBoxTransferables(result));
		} else {
			const layout = await prepareLayout(set, cfg, onProgress);
			post({ reqId, type: 'result', kind: 'layout', result: serializePreparedLayout(layout) });
		}
	} catch (error) {
		post({ reqId, type: 'error', error: error instanceof Error ? error.message : String(error) });
	}
};
