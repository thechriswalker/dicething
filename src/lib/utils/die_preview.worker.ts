// Off-thread die thumbnails. Kept separate from die_engine.worker so engraving
// builds and preview rasterisation never block viewport pointer / camera work.
import { DOMParser } from 'xmldom';
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'undefined') {
	(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
}

import dice from '$lib/dice';
import type { Dice } from '$lib/interfaces/storage.svelte';
import {
	Box3,
	Mesh,
	Object3D,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGLRenderer
} from 'three';
import { Builder } from './builder';
import { parseDieJson } from './die_worker_parse';
import { resolveWorkerLegends } from './die_worker_legends';
import type { PreviewRequest, PreviewResponse } from './die_preview_protocol';

const previewCache = new Map<string, ImageBitmap>();
let previewQueue = Promise.resolve();

const PREVIEW_SIZE = 256;
const PREVIEW_MARGIN = 1.08;
const previewScene = new Scene();
let previewCanvas: OffscreenCanvas | undefined;
let previewRenderer: WebGLRenderer | undefined;

function getPreviewRenderer(): { canvas: OffscreenCanvas; renderer: WebGLRenderer } {
	previewCanvas ??= new OffscreenCanvas(PREVIEW_SIZE, PREVIEW_SIZE);
	previewRenderer ??= new WebGLRenderer({
		antialias: true,
		alpha: true,
		canvas: previewCanvas,
		preserveDrawingBuffer: true
	});
	previewRenderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
	return { canvas: previewCanvas, renderer: previewRenderer };
}

function disposePreviewMeshes(root: Object3D) {
	root.traverse((o) => {
		const mesh = o as Mesh;
		if (mesh.isMesh) {
			mesh.geometry?.dispose();
		}
	});
}

function post(msg: PreviewResponse, transfer?: Transferable[]) {
	(self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function fitPreviewCamera(camera: PerspectiveCamera, object: Object3D) {
	const box = new Box3().setFromObject(object);
	if (box.isEmpty()) {
		camera.position.set(0, 0, 60);
		camera.lookAt(0, 0, 0);
		return;
	}
	const center = box.getCenter(new Vector3());
	const dir = camera.position.clone().normalize();
	const right = new Vector3().crossVectors(dir, camera.up).normalize();
	const up = new Vector3().crossVectors(right, dir).normalize();
	const tan = Math.tan((camera.fov * Math.PI) / 180 / 2);
	let distance = 0;
	let maxDepth = 0;
	const corner = new Vector3();
	for (let xi = 0; xi < 2; xi++) {
		for (let yi = 0; yi < 2; yi++) {
			for (let zi = 0; zi < 2; zi++) {
				corner.set(
					xi ? box.max.x : box.min.x,
					yi ? box.max.y : box.min.y,
					zi ? box.max.z : box.min.z
				);
				corner.sub(center);
				const w = corner.dot(dir);
				const lateral = Math.max(Math.abs(corner.dot(right)), Math.abs(corner.dot(up)));
				distance = Math.max(distance, (lateral * PREVIEW_MARGIN) / tan + w);
				maxDepth = Math.max(maxDepth, Math.abs(w));
			}
		}
	}
	camera.position.copy(center).addScaledVector(dir, distance);
	const pad = maxDepth * 0.1 + 1;
	camera.near = Math.max(0.1, distance - maxDepth - pad);
	camera.far = distance + maxDepth + pad;
	camera.updateProjectionMatrix();
	camera.lookAt(center);
}

function previewCacheKey(
	d: Dice,
	legendSetId: string,
	legendUpdated?: number
): string {
	return JSON.stringify({
		kind: d.kind,
		legendSetId,
		legendUpdated,
		parameters: d.parameters,
		face_parameters: d.face_parameters,
		string_parameters: d.string_parameters ?? {},
		legend_ordering: d.legend_ordering
	});
}

async function renderPreview(
	dieJson: string,
	legendSetId: string,
	legendUpdated: number | undefined,
	legendsJson: string | undefined,
	reqId: number
): Promise<void> {
	const die = parseDieJson(dieJson);
	const key = previewCacheKey(die, legendSetId, legendUpdated);
	const cached = previewCache.get(key);
	if (cached) {
		const clone = await createImageBitmap(cached);
		post({ reqId, type: 'previewResult', dieId: die.id, bitmap: clone }, [clone]);
		return;
	}
	await new Promise<void>((resolve, reject) => {
		previewQueue = previewQueue.catch(() => {}).then(async () => {
			try {
				const hit = previewCache.get(key);
				if (hit) {
					const clone = await createImageBitmap(hit);
					post({ reqId, type: 'previewResult', dieId: die.id, bitmap: clone }, [clone]);
					resolve();
					return;
				}
				const legends = await resolveWorkerLegends(legendsJson, legendSetId);
				const builder = new Builder(dice[die.kind], legends, die.id);
				builder.flatLegendPreview = true;
				builder.build(
					die.parameters,
					die.face_parameters,
					{ explode: false, ordering: die.legend_ordering },
					die.string_parameters ?? {}
				);
				const { canvas, renderer } = getPreviewRenderer();
				previewScene.clear();
				previewScene.add(builder.diceGroup);
				const largeFace = builder.getFaces().findLast((x) => x.isNumberFace);
				const camera = new PerspectiveCamera(30, 1, 1, 500);
				camera.position.set(0, 0, 1);
				builder.getPreviewTransform()?.applyRotationToCamera(camera);
				largeFace?.transform?.applyRotationToCamera(camera);
				fitPreviewCamera(camera, builder.diceGroup);
				renderer.render(previewScene, camera);
				const bitmap = await createImageBitmap(canvas);
				previewScene.remove(builder.diceGroup);
				disposePreviewMeshes(builder.diceGroup);
				previewCache.set(key, bitmap);
				const clone = await createImageBitmap(bitmap);
				post({ reqId, type: 'previewResult', dieId: die.id, bitmap: clone }, [clone]);
				resolve();
			} catch (e) {
				reject(e);
			}
		});
	});
}

async function handleRequest(msg: PreviewRequest) {
	const { reqId, kind } = msg;
	try {
		switch (kind) {
			case 'previewDie':
				await renderPreview(
					msg.dieJson,
					msg.legendSetId,
					msg.legendUpdated,
					msg.legendsJson,
					reqId
				);
				break;
			case 'warmKinds': {
				const kinds = Object.keys(dice) as Array<Dice['kind']>;
				for (const kindId of kinds) {
					const die: Dice = {
						id: `warm:${kindId}`,
						kind: kindId,
						parameters: {},
						face_parameters: []
					};
					await renderPreview(
						JSON.stringify(die),
						msg.legendSetId,
						msg.legendUpdated,
						msg.legendsJson,
						reqId
					);
				}
				post({ reqId, type: 'ok' });
				break;
			}
			default:
				post({ reqId, type: 'error', error: `unknown kind ${(msg as PreviewRequest).kind}` });
		}
	} catch (e) {
		post({ reqId, type: 'error', error: e instanceof Error ? e.message : String(e) });
	}
}

let pending: Array<PreviewRequest> = [];
let drainRunning = false;

async function drain() {
	if (drainRunning) {
		return;
	}
	drainRunning = true;
	try {
		while (pending.length > 0) {
			const msg = pending.shift()!;
			await handleRequest(msg);
		}
	} finally {
		drainRunning = false;
		if (pending.length > 0) {
			void drain();
		}
	}
}

self.onmessage = (event: MessageEvent<PreviewRequest>) => {
	pending.push(event.data);
	void drain();
};

(self as unknown as Worker).postMessage({ type: 'previewWorkerReady' });
