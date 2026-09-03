import { browser } from '$app/environment';
import dice from '$lib/dice';
import { isBuiltin } from '$lib/fonts';
import { dieToJSON, type Dice } from '$lib/interfaces/storage.svelte';
import type { LegendSet } from '$lib/utils/legends';
import {
	idbDeleteDiePreviewsForLegend,
	idbGetDiePreview,
	idbPutDiePreview,
	idbTouchDiePreview
} from '$lib/utils/die_preview_idb';
import { diePreviewCacheKey } from '$lib/utils/die_preview_key';
import {
	canUseStaticDiePreview,
	staticBlanksPreviewUrl,
	staticDiePreviewUrl
} from '$lib/utils/die_preview_static';
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

type SharedPreview = {
	source: 'static' | 'idb' | 'worker';
	/** Static path, or undefined when `blob` is set. */
	url?: string;
	blob?: Blob;
};

/** In-flight resolves keyed by cache key — dedupe modal/warm storms. */
const inflightResolves = new Map<string, Promise<SharedPreview>>();

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

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob | null> {
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return null;
	}
	ctx.drawImage(bitmap, 0, 0);
	const webp = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob((b) => resolve(b), 'image/webp', 0.9);
	});
	if (webp) {
		return webp;
	}
	// Safari / older engines may refuse image/webp from toBlob.
	return new Promise<Blob | null>((resolve) => {
		canvas.toBlob((b) => resolve(b), 'image/png');
	});
}

/** Immediate placeholder URL (static blanks or builtin static). May 404 until generated. */
export function diePreviewPlaceholderUrl(die: Dice, legends: LegendSet): string | undefined {
	if (!browser) {
		return undefined;
	}
	if (canUseStaticDiePreview(die, legends)) {
		return staticDiePreviewUrl(die.kind, legends.id);
	}
	// custom (or non-catalogue): show blank shape until the real render arrives
	return staticBlanksPreviewUrl(die.kind);
}

export type ResolvedDiePreview = {
	/** Object URL or static path. */
	url: string;
	/** True when `url` is a blob: object URL the caller should revoke. */
	revocable: boolean;
	source: 'static' | 'idb' | 'worker';
};

function toResolved(shared: SharedPreview): ResolvedDiePreview {
	if (shared.blob) {
		return {
			url: URL.createObjectURL(shared.blob),
			revocable: true,
			source: shared.source
		};
	}
	return {
		url: shared.url!,
		revocable: false,
		source: shared.source
	};
}

/**
 * Resolve a preview image URL: static builtins → IndexedDB → worker render.
 * Worker results for custom legends are persisted to IDB (legend-set LRU).
 */
export async function resolveDiePreview(
	die: Dice,
	legends: LegendSet,
	opts: { skipStatic?: boolean } = {}
): Promise<ResolvedDiePreview> {
	if (!opts.skipStatic && canUseStaticDiePreview(die, legends)) {
		const url = staticDiePreviewUrl(die.kind, legends.id);
		const available = await staticPreviewExists(url);
		if (available) {
			return { url, revocable: false, source: 'static' };
		}
		// fall through to worker when the WebP is not in the distribution yet
	}

	const legendUpdated =
		'updated' in legends ? (legends as { updated?: number }).updated : undefined;
	const key = diePreviewCacheKey(die, legends.id, legendUpdated);

	let sharedPromise = inflightResolves.get(key);
	if (!sharedPromise) {
		sharedPromise = resolveDiePreviewShared(die, legends, key);
		inflightResolves.set(key, sharedPromise);
		void sharedPromise.finally(() => {
			if (inflightResolves.get(key) === sharedPromise) {
				inflightResolves.delete(key);
			}
		});
	}
	return toResolved(await sharedPromise);
}

async function resolveDiePreviewShared(
	die: Dice,
	legends: LegendSet,
	key: string
): Promise<SharedPreview> {
	if (!isBuiltin(legends.id)) {
		try {
			const cached = await idbGetDiePreview(key);
			if (cached) {
				void idbTouchDiePreview(key, legends.id).catch(() => {});
				return { source: 'idb', blob: cached };
			}
		} catch (e) {
			// IDB upgrade / quota issues must not block live renders
			console.warn('die preview idb get failed', e);
		}
	}

	const bitmap = await requestDiePreviewFromWorker(die, legends);
	try {
		if (bitmap.width === 0 || bitmap.height === 0) {
			throw new Error('empty preview bitmap');
		}
		const blob = await bitmapToBlob(bitmap);
		if (!blob) {
			throw new Error('failed to encode preview');
		}
		if (!isBuiltin(legends.id)) {
			void idbPutDiePreview(key, legends.id, blob).catch((e) =>
				console.warn('die preview idb put failed', e)
			);
		}
		return { source: 'worker', blob };
	} finally {
		bitmap.close();
	}
}

const staticExistsCache = new Map<string, boolean>();

async function staticPreviewExists(url: string): Promise<boolean> {
	const hit = staticExistsCache.get(url);
	if (hit !== undefined) {
		return hit;
	}
	try {
		const res = await fetch(url, { method: 'GET', cache: 'force-cache' });
		const ok = res.ok;
		staticExistsCache.set(url, ok);
		return ok;
	} catch {
		staticExistsCache.set(url, false);
		return false;
	}
}

function requestDiePreviewFromWorker(die: Dice, legends: LegendSet): Promise<ImageBitmap> {
	const legendUpdated =
		'updated' in legends ? (legends as { updated?: number }).updated : undefined;
	return request<ImageBitmap>({
		kind: 'previewDie',
		dieJson: dieToJSON(die),
		legendSetId: legends.id,
		legendUpdated,
		legendsJson: legendsJsonForEngine(legends)
	} as Omit<PreviewRequest, 'reqId'>);
}

/** @deprecated prefer resolveDiePreview — kept for callers that want a raw bitmap. */
export async function requestDiePreview(die: Dice, legends: LegendSet): Promise<ImageBitmap> {
	return requestDiePreviewFromWorker(die, legends);
}

export function warmDefaultKindPreviews(legends: LegendSet) {
	if (!browser) {
		return;
	}
	// builtins: static assets cover the picker; nothing to warm into IDB.
	if (isBuiltin(legends.id)) {
		return;
	}
	const legendUpdated =
		'updated' in legends ? (legends as { updated?: number }).updated : undefined;
	const sig = `${legends.id}|${legendUpdated ?? ''}`;
	if (sig === lastWarmSig) {
		return;
	}
	lastWarmSig = sig;
	const kinds = Object.keys(dice) as Array<Dice['kind']>;
	void (async () => {
		for (const kindId of kinds) {
			const die: Dice = {
				id: `warm:${kindId}`,
				kind: kindId,
				parameters: {},
				face_parameters: []
			};
			try {
				const resolved = await resolveDiePreview(die, legends);
				if (resolved.revocable) {
					URL.revokeObjectURL(resolved.url);
				}
			} catch (e) {
				console.warn('warm preview failed', kindId, e);
			}
		}
	})();
}

/** Drop cached previews when a custom legend set is deleted or rewritten. */
export function invalidateDiePreviewsForLegend(legendSetId: string): void {
	if (!browser || isBuiltin(legendSetId)) {
		return;
	}
	lastWarmSig = '';
	void idbDeleteDiePreviewsForLegend(legendSetId).catch((e) =>
		console.warn('die preview idb clear failed', e)
	);
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
