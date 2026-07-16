// Main-thread client for the die-engine worker.
import { browser } from '$app/environment';
import DieEngineWorker from './die_engine.worker?worker';
import type {
	DieBuildMetadata,
	EngineOutlineState,
	EnginePointerEvent,
	EngineRequest,
	EngineResponse,
	EngineSelectionState,
	SerialisedExportMesh,
	StorageUpdatedPayload
} from './die_engine_protocol';
import { ENGINE_STORAGE_CHANNEL } from './die_engine_protocol';
import { migrateLocalStorageToIdb } from './die_engine_migrate';
import { engineTraceSpan } from './engine_trace';
import {
	deleteLegendRecord,
	deleteSetRecord,
	loadStorageSnapshot,
	saveLegendRecord,
	saveSetRecord
} from './die_engine_storage';
import { engineBuffersToGeometry } from './die_engine_serialize';
import type { MeshCheckReport } from './mesh_check';
import { Mesh, MeshNormalMaterial } from 'three';

type Pending = {
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
	onProgress?: (p: { phase: string; label?: string }) => void;
};

let worker: Worker | undefined;
let nextReqId = 1;
const pending = new Map<number, Pending>();
let initPromise: Promise<StorageUpdatedPayload> | undefined;
let storageSnapshot: StorageUpdatedPayload | undefined;

let workerReady = false;
let workerReadyResolve: (() => void) | undefined;
let workerReadyPromise: Promise<void> | undefined;
const outboundQueue: Array<{ msg: EngineRequest; transfer?: Transferable[] }> = [];

const selectionListeners = new Set<(state: EngineSelectionState) => void>();
let storageListeners = new Set<(payload: StorageUpdatedPayload) => void>();

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
	for (const { msg, transfer } of outboundQueue) {
		worker!.postMessage(msg, transfer ?? []);
	}
	outboundQueue.length = 0;
}

function postToWorker(msg: EngineRequest, transfer?: Transferable[]) {
	const w = getWorker();
	if (!workerReady) {
		outboundQueue.push({ msg, transfer });
		return;
	}
	w.postMessage(msg, transfer ?? []);
}

function getWorker(): Worker {
	if (!browser) {
		throw new Error('die-engine worker is only available in the browser');
	}
	if (!worker) {
		resetWorkerReadyGate();
		worker = new DieEngineWorker({ name: 'die-engine' });
		worker.addEventListener('message', onWorkerMessage);
		worker.addEventListener('error', (e) => console.error('die-engine worker error', e));
		worker.addEventListener('messageerror', (e) =>
			console.error('die-engine worker message error', e)
		);
		try {
			const channel = new BroadcastChannel(ENGINE_STORAGE_CHANNEL);
			channel.addEventListener('message', (e: MessageEvent<StorageUpdatedPayload>) => {
				storageSnapshot = e.data;
				for (const fn of storageListeners) {
					fn(e.data);
				}
			});
		} catch {
			// ignore
		}
	}
	return worker;
}

function onWorkerMessage(
	event: MessageEvent<
		| EngineResponse
		| { type: 'selection'; state: EngineSelectionState }
		| { type: 'engineWorkerReady' }
	>
) {
	const msg = event.data;
	if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'engineWorkerReady') {
		engineTraceSpan('client:workerReady').end();
		markWorkerReady();
		return;
	}
	if ('type' in msg && msg.type === 'selection' && !('reqId' in msg)) {
		for (const fn of selectionListeners) {
			fn(msg.state);
		}
		return;
	}
	const m = msg as EngineResponse;
	if (!('reqId' in m)) {
		return;
	}
	if (m.type === 'progress') {
		pending.get(m.reqId)?.onProgress?.(m.progress);
		return;
	}
	const p = pending.get(m.reqId);
	if (!p) {
		if (m.type !== 'ok' || m.reqId !== 0) {
			engineTraceSpan('client:orphan').end({ reqId: m.reqId, type: m.type });
		}
		return;
	}
	pending.delete(m.reqId);
	if (m.type === 'error') {
		p.reject(new Error(m.error));
	} else if (m.type === 'buildDone') {
		p.resolve(m.metadata);
	} else if (m.type === 'storageUpdated') {
		storageSnapshot = m.payload;
		for (const fn of storageListeners) {
			fn(m.payload);
		}
		p.resolve(m.payload);
	} else {
		p.resolve(m);
	}
}

function broadcastStorageSnapshot(payload: StorageUpdatedPayload) {
	try {
		const channel = new BroadcastChannel(ENGINE_STORAGE_CHANNEL);
		channel.postMessage(payload);
		channel.close();
	} catch {
		// BroadcastChannel unavailable
	}
}

function applyStorageSnapshot(payload: StorageUpdatedPayload) {
	storageSnapshot = payload;
}

async function notifyStorageListeners(payload: StorageUpdatedPayload) {
	applyStorageSnapshot(payload);
	for (const fn of storageListeners) {
		await fn(payload);
	}
}

// IndexedDB lives on the main thread only — workers sharing the same DB can hang.
async function handleStorageOnMain(
	kind: EngineRequest['kind'],
	payload: Omit<EngineRequest, 'reqId' | 'kind'>
): Promise<StorageUpdatedPayload> {
	switch (kind) {
		case 'storage.init':
		case 'storage.getSets':
			break;
		case 'storage.saveSet':
			await saveSetRecord((payload as { setJson: string }).setJson);
			break;
		case 'storage.deleteSet':
			await deleteSetRecord((payload as { setId: string }).setId);
			break;
		case 'storage.saveLegend':
			await saveLegendRecord((payload as { legendJson: string }).legendJson);
			break;
		case 'storage.deleteLegend':
			await deleteLegendRecord((payload as { legendId: string }).legendId);
			break;
		default:
			throw new Error(`not a storage request: ${kind}`);
	}
	const snapshot = await loadStorageSnapshot();
	await notifyStorageListeners(snapshot);
	broadcastStorageSnapshot(snapshot);
	return snapshot;
}

function request<T>(
	kind: EngineRequest['kind'],
	payload: Omit<EngineRequest, 'reqId' | 'kind'> = {}
): Promise<T> {
	if (kind.startsWith('storage.')) {
		const span = engineTraceSpan(`client:${kind}`);
		return handleStorageOnMain(kind, payload).then(
			(snapshot) => {
				span.end({ sets: snapshot.sets.length, legends: snapshot.legends.length });
				return snapshot as T;
			},
			(error: unknown) => {
				span.end({ error: error instanceof Error ? error.message : String(error) });
				throw error;
			}
		);
	}
	getWorker();
	const reqId = nextReqId++;
	const span = engineTraceSpan(`client:${kind}`);
	return new Promise<T>((resolve, reject) => {
		pending.set(reqId, {
			resolve: (value: unknown) => {
				span.end();
				resolve(value as T);
			},
			reject: (error: unknown) => {
				span.end({ error: error instanceof Error ? error.message : String(error) });
				reject(error);
			}
		});
		const msg = { reqId, kind, ...payload } as EngineRequest;
		if (kind === 'initViewport' && 'canvas' in payload) {
			postToWorker(msg, [payload.canvas as OffscreenCanvas]);
		} else if (kind === 'meshCheck' && 'positions' in payload) {
			const copy = Float32Array.from((payload as { positions: Float32Array }).positions);
			(msg as EngineRequest & { positions: Float32Array }).positions = copy;
			postToWorker(msg, [copy.buffer]);
		} else {
			postToWorker(msg);
		}
	});
}

export function ensureEngineWorker(): void {
	getWorker();
}

export function whenEngineWorkerReady(): Promise<void> {
	getWorker();
	return workerReadyPromise ?? Promise.resolve();
}

export async function initEngineStorage(): Promise<StorageUpdatedPayload> {
	if (!browser) {
		return { sets: [], legends: [] };
	}
	if (initPromise) {
		return initPromise;
	}
	initPromise = (async () => {
		await migrateLocalStorageToIdb();
		return request<StorageUpdatedPayload>('storage.init', {});
	})().catch((e) => {
		initPromise = undefined;
		throw e;
	});
	return initPromise;
}

export function getEngineStorageSnapshot(): StorageUpdatedPayload | undefined {
	return storageSnapshot;
}

export function onEngineStorageUpdated(fn: (payload: StorageUpdatedPayload) => void): () => void {
	storageListeners.add(fn);
	return () => storageListeners.delete(fn);
}

export function onEngineSelection(fn: (state: EngineSelectionState) => void): () => void {
	selectionListeners.add(fn);
	return () => selectionListeners.delete(fn);
}

export function attachEngineViewport(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
	dpr: number,
	backgroundColor: number
): Promise<void> {
	const offscreen = canvas.transferControlToOffscreen();
	return request<void>('initViewport', {
		canvas: offscreen,
		width,
		height,
		dpr,
		backgroundColor
	} as Omit<EngineRequest, 'reqId' | 'kind'>).then(() => undefined);
}

export function detachEngineViewport(): Promise<void> {
	return request<void>('detachViewport', {}).then(() => undefined);
}

export function resizeEngineViewport(width: number, height: number, dpr: number): Promise<void> {
	return request<void>('resizeViewport', { width, height, dpr }).then(() => undefined);
}

export function sendEnginePointer(event: EnginePointerEvent): void {
	if (!worker) {
		return;
	}
	postToWorker({ reqId: 0, kind: 'pointer', event } satisfies EngineRequest);
}

export function loadEngineSet(setId: string, setJson: string, legendsJson: string): Promise<void> {
	return request<void>('loadSet', { setId, setJson, legendsJson }).then(() => undefined);
}

export function setEngineActiveDie(dieId: string): Promise<void> {
	return request<void>('setActiveDie', { dieId }).then(() => undefined);
}

export function buildEngineDie(
	dieJson: string,
	explode: boolean,
	generation: number,
	mountViewport = false
): Promise<DieBuildMetadata> {
	const die = JSON.parse(dieJson) as { id: string };
	return request<DieBuildMetadata>('buildDie', {
		dieId: die.id,
		dieJson,
		explode,
		generation,
		mountViewport
	});
}

export function patchEngineDie(
	dieJson: string,
	explode: boolean,
	generation: number
): Promise<DieBuildMetadata> {
	const die = JSON.parse(dieJson) as { id: string };
	return request<DieBuildMetadata>('patchDie', {
		dieId: die.id,
		dieJson,
		explode,
		generation
	});
}

export function setEngineExploded(explode: boolean): void {
	void request('setExploded', { explode });
}

export function setEngineAutoRotate(enabled: boolean): void {
	void request('setAutoRotate', { enabled });
}

export function setEngineLegendAreaVisible(visible: boolean): void {
	void request('setLegendAreaVisible', { visible });
}

export function setEngineFancy(enabled: boolean): void {
	void request('setFancy', { enabled });
}

export function setEngineWireframe(enabled: boolean): void {
	void request('setWireframe', { enabled });
}

export function setEngineBackground(backgroundColor: number): void {
	if (!worker) {
		return;
	}
	postToWorker({ reqId: 0, kind: 'setBackground', backgroundColor } satisfies EngineRequest);
}

export function setEngineOutline(state: EngineOutlineState): void {
	void request('setOutline', { state });
}

export function resetEngineCamera(): void {
	void request('camera.reset', {});
}

export function lookAtEngineFace(faceIndex: number): void {
	void request('camera.lookAtFace', { faceIndex });
}

export function saveSetInEngine(setJson: string): Promise<StorageUpdatedPayload> {
	return request<StorageUpdatedPayload>('storage.saveSet', { setJson });
}

export function deleteSetInEngine(setId: string): Promise<StorageUpdatedPayload> {
	return request<StorageUpdatedPayload>('storage.deleteSet', { setId });
}

export function saveLegendInEngine(legendJson: string): Promise<StorageUpdatedPayload> {
	return request<StorageUpdatedPayload>('storage.saveLegend', { legendJson });
}

export function deleteLegendInEngine(legendId: string): Promise<StorageUpdatedPayload> {
	return request<StorageUpdatedPayload>('storage.deleteLegend', { legendId });
}

export type EngineExportResult = {
	meshes: Array<{ name: string; dieId: string; group: string; mesh: Mesh }>;
	engravingErrors: Array<import('./builder').EngravingError>;
	meshReport: MeshCheckReport;
};

export function exportDieInEngine(
	dieJson: string,
	legendsJson: string,
	includeDice: boolean,
	optionStatesJson: string
): Promise<EngineExportResult> {
	return request<{
		type: 'exportResult';
		meshes: SerialisedExportMesh[];
		engravingErrors: EngineExportResult['engravingErrors'];
		meshReport: MeshCheckReport;
	}>('exportDie', {
		dieJson,
		legendsJson,
		includeDice,
		optionStatesJson
	}).then((r) => {
		const mat = new MeshNormalMaterial();
		return {
			engravingErrors: r.engravingErrors,
			meshReport: r.meshReport,
			meshes: r.meshes.map((m) => ({
				name: m.name,
				dieId: m.dieId,
				group: m.group,
				mesh: new Mesh(engineBuffersToGeometry(m.geometry), mat)
			}))
		};
	});
}

export function meshCheckInEngine(
	positions: Float32Array,
	collectBad?: boolean
): Promise<MeshCheckReport> {
	return request<{ type: 'meshCheckResult'; report: MeshCheckReport }>('meshCheck', {
		positions,
		collectBad
	}).then((r) => (r as { report: MeshCheckReport }).report);
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		for (const p of pending.values()) {
			p.reject(new Error('die-engine worker disposed'));
		}
		worker?.terminate();
		worker = undefined;
		pending.clear();
		outboundQueue.length = 0;
		workerReady = false;
		workerReadyPromise = undefined;
		workerReadyResolve = undefined;
		initPromise = undefined;
	});
}
