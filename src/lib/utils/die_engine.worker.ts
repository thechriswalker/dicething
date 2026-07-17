// Die-engine worker: engraving builds and offscreen viewport rendering.
import { installWorkerWindowPolyfill } from './die_engine_worker_dom';
installWorkerWindowPolyfill();

import { DOMParser } from 'xmldom';
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'undefined') {
	(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
}

import dice from '$lib/dice';
import type { Dice } from '$lib/interfaces/storage.svelte';
import { Builder } from './builder';
import { EngineViewport } from './die_engine_scene';
import { metadataFromBuilder } from './die_engine_metadata';
import { geometryToEngineBuffers, exportMeshTransferables } from './die_engine_serialize';
import type {
	EngineOutlineState,
	EngineRequest,
	EngineResponse,
	EngineSelectionState
} from './die_engine_protocol';
import { engineTrace, engineTraceSpan } from './engine_trace';
import { resolveWorkerLegends } from './die_worker_legends';
import { parseDieJson, dieJsonReviver } from './die_worker_parse';
import { buildExportMeshesForDie, checkExportMesh, disposeNamedManifolds } from './export';
import { checkMesh, mergeMeshReports } from './mesh_check';
import { engravingErrorsForBuilder } from './builder';
import type { LegendSet } from './legends';
import type { DiceSet } from '$lib/interfaces/storage.svelte';

const builders = new Map<string, Builder>();
let viewport: EngineViewport | undefined;
let activeDieId = '';
let activeBuilder: Builder | undefined;
let outlineState: EngineOutlineState = {
	primaryFaces: [],
	secondaryFaces: [],
	legendAreaFaces: [],
	legendErrorFaces: []
};
let legendAreaVisible = false;
let fancyEnabled = false;
let currentSet: DiceSet | undefined;

function post(
	msg: EngineResponse | { type: 'selection'; state: EngineSelectionState },
	transfer?: Transferable[]
) {
	(self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function ensureBuilder(die: Dice, legends: LegendSet): Builder {
	let b = builders.get(die.id);
	if (!b) {
		b = new Builder(dice[die.kind], legends, die.id);
		builders.set(die.id, b);
	}
	return b;
}

function setActiveDieId(dieId: string) {
	activeDieId = dieId;
	const builder = builders.get(dieId);
	if (builder && viewport) {
		mountActiveDie(builder, dieId);
	}
}

function styleActiveDieMeshes() {
	if (!viewport || !activeBuilder) {
		return;
	}
	activeBuilder.diceGroup.traverse((o) => {
		if ((o as import('three').Mesh).isMesh) {
			viewport!.styleMesh(o as import('three').Mesh);
		}
	});
}

function mountActiveDie(builder: Builder, dieId: string) {
	if (!viewport) {
		return;
	}
	if (activeBuilder && activeBuilder !== builder) {
		viewport.scene.remove(activeBuilder.diceGroup);
	}
	activeBuilder = builder;
	activeDieId = dieId;
	if (builder.diceGroup.parent && builder.diceGroup.parent !== viewport.scene) {
		builder.diceGroup.parent.remove(builder.diceGroup);
	}
	if (builder.diceGroup.parent !== viewport.scene) {
		viewport.scene.add(builder.diceGroup);
	}
	styleActiveDieMeshes();
	viewport.picker.setTarget({
		dieId,
		root: builder.diceGroup,
		onSelection: (state) => post({ type: 'selection', state })
	});
	applyOutline();
	viewport.composer.render();
}

function applyOutline() {
	if (!viewport || !activeBuilder) {
		return;
	}
	viewport.setOutline(outlineState, (face) => activeBuilder!.getOutlineObjects(face));
	viewport.setLegendAreaOutlines(
		legendAreaVisible ? activeBuilder.getLegendAreaGlowObjects() : [],
		legendAreaVisible ? activeBuilder.getLegendAreaGlowErrorObjects() : []
	);
}

function runBuild(
	builder: Builder,
	die: Dice,
	explode: boolean,
	generation: number,
	reqId: number,
	mountViewport = false
) {
	builder.build(
		die.parameters,
		die.face_parameters,
		{ explode, ordering: die.legend_ordering },
		die.string_parameters ?? {}
	);
	const metadata = metadataFromBuilder(builder, die.id, generation);
	post({ reqId, type: 'buildDone', metadata });
	if (mountViewport || die.id === activeDieId) {
		activeDieId = die.id;
		mountActiveDie(builder, die.id);
	}
}

async function hydrateSet(setJson: string, legendsJson: string): Promise<DiceSet> {
	const stored = JSON.parse(setJson) as {
		id: string;
		name: string;
		updated: number;
		dice: Dice[] | string;
		legends?: string;
	};
	const legends = await resolveWorkerLegends(legendsJson, stored.legends ?? legendsJson);
	const diceArr =
		typeof stored.dice === 'string'
			? (JSON.parse(stored.dice, dieJsonReviver) as Dice[])
			: stored.dice;
	return {
		id: stored.id,
		name: stored.name,
		updated: stored.updated,
		dice: diceArr,
		legends
	};
}

async function handleRequest(msg: EngineRequest) {
	const { reqId, kind } = msg;
	const detail: Record<string, unknown> = { reqId };
	if (kind === 'buildDie' || kind === 'patchDie') {
		detail.dieId = msg.dieId;
		if (kind === 'buildDie' && msg.mountViewport) {
			detail.mountViewport = true;
		}
	}
	const span = engineTraceSpan(`worker:${kind}`);
	try {
		switch (kind) {
			case 'initViewport': {
				viewport?.dispose();
				viewport = new EngineViewport(msg.canvas, msg.width, msg.height, msg.dpr);
				viewport.setBackground(msg.backgroundColor);
				viewport.setFancy(fancyEnabled);
				viewport.onBeforeRender(() => activeBuilder?.update());
				viewport.start();
				if (activeDieId) {
					const builder = builders.get(activeDieId);
					if (builder) {
						mountActiveDie(builder, activeDieId);
					}
				}
				post({ reqId, type: 'ok' });
				break;
			}
			case 'detachViewport':
				viewport?.stop();
				post({ reqId, type: 'ok' });
				break;
			case 'resizeViewport':
				viewport?.resize(msg.width, msg.height, msg.dpr);
				post({ reqId, type: 'ok' });
				break;
			case 'pointer':
				viewport?.dispatchPointer(msg.event);
				post({ reqId, type: 'ok' });
				break;
			case 'camera.reset':
				viewport?.resetCamera();
				post({ reqId, type: 'ok' });
				break;
			case 'camera.lookAtFace':
				if (viewport && activeBuilder) {
					viewport.lookAtFace(msg.faceIndex, (face) => activeBuilder!.getFaces()[face]);
				}
				post({ reqId, type: 'ok' });
				break;
			case 'loadSet': {
				currentSet = await hydrateSet(msg.setJson, msg.legendsJson);
				if (activeBuilder && viewport) {
					viewport.scene.remove(activeBuilder.diceGroup);
				}
				builders.clear();
				activeBuilder = undefined;
				post({ reqId, type: 'ok' });
				break;
			}
			case 'setActiveDie':
				setActiveDieId(msg.dieId);
				post({ reqId, type: 'ok' });
				break;
			case 'patchDie':
			case 'buildDie': {
				if (!currentSet) {
					throw new Error('no set loaded');
				}
				const die = parseDieJson(msg.dieJson);
				const builder = ensureBuilder(die, currentSet.legends);
				const mountViewport = msg.kind === 'buildDie' && !!msg.mountViewport;
				runBuild(builder, die, msg.explode, msg.generation, reqId, mountViewport);
				break;
			}
			case 'setExploded':
				activeBuilder?.setExploded(msg.explode);
				viewport?.setExploded(msg.explode);
				post({ reqId, type: 'ok' });
				break;
			case 'setAutoRotate':
				viewport?.setAutoRotate(msg.enabled);
				post({ reqId, type: 'ok' });
				break;
			case 'setLegendAreaVisible':
				legendAreaVisible = msg.visible;
				activeBuilder?.setLegendAreaVisible(msg.visible);
				post({ reqId, type: 'ok' });
				break;
			case 'setFancy':
				fancyEnabled = msg.enabled;
				viewport?.setFancy(fancyEnabled);
				styleActiveDieMeshes();
				post({ reqId, type: 'ok' });
				break;
			case 'setWireframe':
				viewport?.setWireframe(msg.enabled);
				post({ reqId, type: 'ok' });
				break;
			case 'setOutline':
				outlineState = msg.state;
				applyOutline();
				post({ reqId, type: 'ok' });
				break;
			case 'setBackground':
				viewport?.setBackground(msg.backgroundColor);
				post({ reqId, type: 'ok' });
				break;
			case 'exportDie': {
				if (!currentSet) {
					throw new Error('no set loaded');
				}
				const die = parseDieJson(msg.dieJson);
				const legends = await resolveWorkerLegends(msg.legendsJson, currentSet.legends.id);
				const set: DiceSet = { ...currentSet, legends };
				const idx = set.dice.findIndex((d) => d.id === die.id);
				const optionStates = JSON.parse(msg.optionStatesJson);
				const named = buildExportMeshesForDie(set, die, idx >= 0 ? idx : 0, {
					includeDice: msg.includeDice,
					optionStates,
					builders
				});
				const engravingErrors = engravingErrorsForBuilder(
					builders.get(die.id) ?? ensureBuilder(die, legends),
					die
				);
				// Prefer Manifold index topology while the solids are still alive —
				// geometric welding of the Three.js buffer false-flags micro-edges.
				const meshReport = mergeMeshReports(
					named.map((n) => checkExportMesh(n, { collectBad: true }))
				);
				// Measure while Manifolds are still alive — cheaper and exact vs
				// re-walking the transferred Three.js triangle soup on the main thread.
				// Numbered dice use the blank (pre-engraving) solid so the UI volume
				// excludes legends; artifacts use their own manifolds.
				const groupVolumesMm3: Record<string, number> = {};
				if (msg.includeDice) {
					const builder = builders.get(die.id);
					if (builder) {
						groupVolumesMm3.dice = builder.getBlankVolumeMm3();
					}
				}
				for (const n of named) {
					if (n.group === 'dice' || !n.manifold) {
						continue;
					}
					groupVolumesMm3[n.group] = (groupVolumesMm3[n.group] ?? 0) + n.manifold.volume();
				}
				const meshes = named.map((n) => ({
					name: n.name,
					dieId: n.dieId ?? die.id,
					group: n.group,
					geometry: geometryToEngineBuffers(n.mesh.geometry)
				}));
				disposeNamedManifolds(named);
				for (const n of named) {
					n.mesh.geometry.dispose();
				}
				const { meshes: out, transfer } = exportMeshTransferables(meshes);
				(self as unknown as Worker).postMessage(
					{
						reqId,
						type: 'exportResult',
						meshes: out,
						engravingErrors,
						meshReport,
						groupVolumesMm3
					} satisfies EngineResponse,
					transfer
				);
				break;
			}
			case 'meshCheck': {
				const report = checkMesh(msg.positions, { collectBad: msg.collectBad });
				post({ reqId, type: 'meshCheckResult', report });
				break;
			}
			default:
				post({ reqId, type: 'error', error: `unknown kind ${(msg as EngineRequest).kind}` });
		}
	} catch (e) {
		post({ reqId, type: 'error', error: e instanceof Error ? e.message : String(e) });
	} finally {
		span.end(detail);
	}
}

type QueueEntry = { msg: EngineRequest; seq: number };

let pending: Array<QueueEntry> = [];
let drainRunning = false;
let enqueueSeq = 0;

function requestPriority(msg: EngineRequest): number {
	switch (msg.kind) {
		case 'initViewport':
		case 'detachViewport':
			return 0;
		case 'resizeViewport':
		case 'camera.reset':
		case 'camera.lookAtFace':
		case 'pointer':
		case 'setBackground':
			return 1;
		case 'loadSet':
			return 3;
		case 'setActiveDie':
			return 4;
		case 'buildDie':
			return msg.mountViewport ? 5 : 10;
		case 'patchDie':
			return 10;
		case 'setExploded':
		case 'setAutoRotate':
		case 'setOutline':
		case 'setFancy':
		case 'setWireframe':
		case 'setLegendAreaVisible':
			return 15;
		case 'exportDie':
		case 'meshCheck':
			return 16;
		default:
			return 20;
	}
}

function sortPending() {
	pending.sort((a, b) => {
		const pa = requestPriority(a.msg);
		const pb = requestPriority(b.msg);
		return pa !== pb ? pa - pb : a.seq - b.seq;
	});
}

async function drain() {
	if (drainRunning) {
		return;
	}
	drainRunning = true;
	try {
		while (pending.length > 0) {
			sortPending();
			const { msg } = pending.shift()!;
			await handleRequest(msg);
		}
	} finally {
		drainRunning = false;
		if (pending.length > 0) {
			void drain();
		}
	}
}

self.onmessage = (event: MessageEvent<EngineRequest>) => {
	const msg = event.data;
	pending.push({ msg, seq: enqueueSeq++ });
	engineTrace('worker:queued', {
		kind: msg.kind,
		pending: pending.length,
		pri: requestPriority(msg),
		reqId: msg.reqId
	});
	void drain();
};

engineTrace('worker:ready');
(self as unknown as Worker).postMessage({ type: 'engineWorkerReady' });
