import { browser } from '$app/environment';
import { dieToJSON, type Dice } from '$lib/interfaces/storage.svelte';
import type { LegendSet } from '$lib/utils/legends';
import { legendsJsonForEngine } from '$lib/utils/preview_legends';
import DiePreviewWorker from './die_preview.worker?worker';
import type { PreviewRequest, PreviewResponse } from './die_preview_protocol';

type Pending = {
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
};

let worker: Worker | undefined;
let nextReqId = 1;
const pending = new Map<number, Pending>();

let workerReady = false;
let workerReadyResolve: (() => void) | undefined;
let workerReadyPromise: Promise<void> | undefined;
const outboundQueue: Array<PreviewRequest> = [];

let lastWarmSig = '';

function resetWorkerReadyGate() {
	workerReady = false;
	workerReadyPromise = new Promise<void>((resolve) => {
		workerReadyResolve = resolve;
	});
}

function markWorkerReady() {
	if (workerReady) {
		return;
	}
	workerReady = true;
	workerReadyResolve?.();
	workerReadyResolve = undefined;
	for (const msg of outboundQueue) {
		worker!.postMessage(msg);
	}
	outboundQueue.length = 0;
}

function getWorker(): Worker {
	if (!browser) {
		throw new Error('die-preview worker is only available in the browser');
	}
	if (!worker) {
		resetWorkerReadyGate();
		worker = new DiePreviewWorker({ name: 'die-preview' });
		worker.addEventListener('message', onWorkerMessage);
		worker.addEventListener('error', (e) => console.error('die-preview worker error', e));
		worker.addEventListener('messageerror', (e) =>
			console.error('die-preview worker message error', e)
		);
	}
	return worker;
}

function onWorkerMessage(
	event: MessageEvent<PreviewResponse | { type: 'previewWorkerReady' }>
) {
	const msg = event.data;
	if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'previewWorkerReady') {
		markWorkerReady();
		return;
	}
	const m = msg as PreviewResponse;
	if (!('reqId' in m)) {
		return;
	}
	const p = pending.get(m.reqId);
	if (!p) {
		return;
	}
	pending.delete(m.reqId);
	if (m.type === 'error') {
		p.reject(new Error(m.error));
	} else if (m.type === 'previewResult') {
		p.resolve(m.bitmap);
	} else {
		p.resolve(m);
	}
}

function postToWorker(msg: PreviewRequest) {
	const w = getWorker();
	if (!workerReady) {
		outboundQueue.push(msg);
		return;
	}
	w.postMessage(msg);
}

function request<T>(msg: Omit<PreviewRequest, 'reqId'>): Promise<T> {
	getWorker();
	const reqId = nextReqId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
		postToWorker({ ...msg, reqId } as PreviewRequest);
	});
}

export function warmDefaultKindPreviews(legends: LegendSet) {
	if (!browser) {
		return;
	}
	const legendUpdated = 'updated' in legends ? (legends.updated as number | undefined) : undefined;
	const sig = `${legends.id}|${legendUpdated ?? ''}`;
	if (sig === lastWarmSig) {
		return;
	}
	lastWarmSig = sig;
	void request<void>({
		kind: 'warmKinds',
		legendSetId: legends.id,
		legendUpdated,
		legendsJson: legendsJsonForEngine(legends)
	} as Omit<PreviewRequest, 'reqId'>);
}

export async function requestDiePreview(die: Dice, legends: LegendSet): Promise<ImageBitmap> {
	const legendUpdated = 'updated' in legends ? (legends.updated as number | undefined) : undefined;
	return request<ImageBitmap>({
		kind: 'previewDie',
		dieJson: dieToJSON(die),
		legendSetId: legends.id,
		legendUpdated,
		legendsJson: legendsJsonForEngine(legends)
	} as Omit<PreviewRequest, 'reqId'>);
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		for (const p of pending.values()) {
			p.reject(new Error('die-preview worker disposed'));
		}
		worker?.terminate();
		worker = undefined;
		pending.clear();
		outboundQueue.length = 0;
		workerReady = false;
		workerReadyPromise = undefined;
		workerReadyResolve = undefined;
		lastWarmSig = '';
	});
}
