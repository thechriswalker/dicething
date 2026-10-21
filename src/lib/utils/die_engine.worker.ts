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
import { Group } from 'three';
import {
	assembleBlankExportShellGeometry,
	getOrBuildBlankManifold,
	transformToMat4
} from './die_manifold';
import {
	computeSupportRegions,
	iterateSupportSolids,
	meshFromSupportSolid,
	DEFAULT_SUPPORT_LAYER_VISIBILITY,
	filterSupportRegions,
	mergeSupportSettings,
	orientFaceLegendShapes,
	sampleSupportContacts,
	SupportCancelledError,
	type SupportCancelToken,
	type SupportLayerVisibility,
	type SupportRegions
} from './supports';
import { buildPlacementOverlay, disposeOverlayGroup } from './supports/placement';

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

// Latest requested build generation per dieId.
// Used to avoid running expensive geometry builds for stale queued requests.
const latestBuildGenerationByDieId = new Map<string, number>();

// Supports preview state (print-pose overlay on the active die).
let supportsPreviewEnabled = false;
let supportsOverlay: Group | undefined;
let latestSupportsGeneration = 0;
let supportsCancel: SupportCancelToken = { cancelled: false };
let cachedSupportRegions: SupportRegions | undefined;
/** Region cache key: die id + settings that affect placement (not pillar/cone sizes). */
let cachedSupportsRegionKey = '';
let latestExportGeneration = 0;

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
	if (dieId !== activeDieId) {
		// Drop stale supports immediately so the previous die's overlay does not
		// linger while the next die's regions rebuild.
		clearSupportsOverlay();
		cachedSupportRegions = undefined;
		cachedSupportsRegionKey = '';
		supportsCancel.cancelled = true;
	}
	activeDieId = dieId;
	const builder = builders.get(dieId);
	if (builder && viewport) {
		mountActiveDie(builder, dieId);
		// Keep print-pose in sync with the supports flag (pose can otherwise
		// linger after a cancelled rebuild and leave the die off-camera).
		setDicePrintPose(supportsPreviewEnabled);
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

// `currentSet` is the snapshot from loadSet. Builds carry the latest die
// (including ones added or duplicated since load); supports read face params
// from this list, so a die that was never loaded would otherwise be missing.
function upsertSetDie(die: Dice) {
	if (!currentSet) {
		return;
	}
	const idx = currentSet.dice.findIndex((d) => d.id === die.id);
	if (idx >= 0) {
		currentSet.dice[idx] = die;
	} else {
		currentSet.dice.push(die);
	}
}

function runBuild(
	builder: Builder,
	die: Dice,
	explode: boolean,
	generation: number,
	reqId: number,
	mountViewport = false
) {
	upsertSetDie(die);
	builder.build(
		die.parameters,
		die.face_parameters,
		{ explode, ordering: die.legend_ordering },
		die.string_parameters ?? {}
	);
	// Die geometry changed — region cache is stale.
	cachedSupportRegions = undefined;
	cachedSupportsRegionKey = '';
	const metadata = metadataFromBuilder(builder, die.id, generation);
	post({ reqId, type: 'buildDone', metadata });
	if (mountViewport || die.id === activeDieId) {
		activeDieId = die.id;
		mountActiveDie(builder, die.id);
		// Always sync pose: if supports were cancelled mid-build the die can be
		// left in print orientation while the camera still aims at model space.
		applySupportsPreviewVisibility();
	}
}

function postProgress(
	reqId: number,
	phase: string,
	fraction?: number,
	label?: string,
	counts?: { step: number; total: number }
) {
	post({
		reqId,
		type: 'progress',
		progress: { phase, label, fraction, step: counts?.step, total: counts?.total }
	});
}

function clearSupportsOverlay() {
	if (supportsOverlay && viewport) {
		viewport.scene.remove(supportsOverlay);
		disposeOverlayGroup(supportsOverlay);
		supportsOverlay = undefined;
	}
}

// Die whose print view has already been framed. Rebuilding supports for the
// same die must not snap the camera back; switching dice does.
let printFramedDieId: string | null = null;

function setDicePrintPose(on: boolean) {
	if (!activeBuilder) {
		return;
	}
	const g = activeBuilder.diceGroup;
	if (on) {
		const printT = activeBuilder.getPrintingTransform();
		g.matrixAutoUpdate = false;
		g.matrix.fromArray(transformToMat4(printT));
		g.updateMatrixWorld(true);
		// Rafts lie on the world xz plane. Frame that plane level in the viewport
		// when support mode starts or the die changes; a later rebuild only
		// follows a change in lift.
		if (printFramedDieId !== activeDieId) {
			viewport?.frameLevelPrintView(printT.translation);
			printFramedDieId = activeDieId;
		} else {
			viewport?.setViewCenter(printT.translation);
		}
	} else {
		g.matrix.identity();
		g.matrixAutoUpdate = true;
		g.updateMatrixWorld(true);
		if (printFramedDieId !== null) {
			viewport?.restoreFramedView();
			printFramedDieId = null;
		}
	}
}

function applySupportsPreviewVisibility() {
	if (!viewport) {
		return;
	}
	setDicePrintPose(supportsPreviewEnabled);
	if (!supportsPreviewEnabled) {
		clearSupportsOverlay();
	} else if (supportsOverlay && supportsOverlay.parent !== viewport.scene) {
		viewport.scene.add(supportsOverlay);
	}
	viewport.composer.render();
}

/**
 * Let already-queued worker messages (pointer moves) run before the next heavy
 * step. The timer callback only posts a follow-up message and returns: if the
 * heavy work continued as a microtask of that timer, Chrome reports the whole
 * chunk as a setTimeout handler.
 */
function yieldToRenderer(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(() => {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => resolve();
			channel.port2.postMessage(null);
		}, 0);
	});
}

async function runBuildSupports(
	reqId: number,
	settingsJson: string,
	mode: 'placement' | 'solid',
	generation: number,
	layersJson?: string
) {
	if (!activeBuilder || !currentSet) {
		throw new Error('no active die');
	}
	// Remove the previous overlay up front so a slow rebuild never leaves the
	// wrong die's supports on screen.
	clearSupportsOverlay();
	await yieldToRenderer();
	if (generation !== latestSupportsGeneration) {
		post({
			reqId,
			type: 'supportsResult',
			result: {
				generation,
				mode,
				edgeLineCount: 0,
				legendPointCount: 0,
				contactCount: 0,
				tipPostFinCount: 0
			}
		});
		return;
	}

	supportsCancel = { cancelled: false };
	const settings = mergeSupportSettings(JSON.parse(settingsJson));
	const builder = activeBuilder;
	const faces = builder.getFaces();
	const printT = builder.getPrintingTransform();
	const die = currentSet.dice.find((d) => d.id === activeDieId);
	if (!die) {
		throw new Error('active die missing from set');
	}

	const faceShapes = orientFaceLegendShapes(faces, die.face_parameters, currentSet.legends, (l) =>
		builder.getDefaultScaleForLegend(l)
	);

	// Placement regions depend on inset + tip nudge, not pillar/cone/raft sizes.
	const regionKey = JSON.stringify({
		dieId: activeDieId,
		edgeInsetMm: settings.edgeInsetMm,
		sphereDiameterMm: settings.sphereDiameterMm,
		edgeSpacingMm: settings.edgeSpacingMm,
		legendSpacingMm: settings.legendSpacingMm,
		faceMinAngleDeg: settings.faceMinAngleDeg,
		// Bump when edge-selection policy changes so stale region caches die.
		edgePolicy: 'host-face-v1',
		legendPolicy: 'contour-spaced-v1'
	});
	let regions = cachedSupportRegions;
	if (!regions || cachedSupportsRegionKey !== regionKey) {
		regions = computeSupportRegions(faces, printT, faceShapes, settings, {
			cancel: supportsCancel,
			onProgress: (phase, frac, label) => {
				if (generation !== latestSupportsGeneration) {
					supportsCancel.cancelled = true;
				}
				postProgress(reqId, phase, frac, label);
			}
		});
		if (generation !== latestSupportsGeneration || supportsCancel.cancelled) {
			throw new SupportCancelledError();
		}
		cachedSupportRegions = regions;
		cachedSupportsRegionKey = regionKey;
	}

	await yieldToRenderer();
	if (generation !== latestSupportsGeneration || supportsCancel.cancelled) {
		throw new SupportCancelledError();
	}

	let layers: SupportLayerVisibility = DEFAULT_SUPPORT_LAYER_VISIBILITY;
	if (layersJson) {
		try {
			layers = { ...DEFAULT_SUPPORT_LAYER_VISIBILITY, ...JSON.parse(layersJson) };
		} catch {
			/* keep defaults */
		}
	}
	// Filter after cache so toggling layers does not recompute regions.
	const visible = filterSupportRegions(regions, layers);

	supportsPreviewEnabled = true;
	setDicePrintPose(true);

	let contactCount = 0;
	if (mode === 'placement') {
		const overlay = buildPlacementOverlay(visible, settings);
		supportsOverlay = overlay;
		viewport?.scene.add(overlay);
		contactCount = sampleSupportContacts(visible, settings).length;
	} else {
		// Placement already produced the regions. Sampling contacts is cheap, so
		// the UI can show "0 of Y" before the blank manifold and pillar solids,
		// which are what keep this worker (and the canvas) busy.
		const supportTotal =
			sampleSupportContacts(visible, settings).length + (visible.tipPost ? 1 : 0);
		if (supportTotal > 0) {
			postProgress(reqId, 'supports-solid', 0, undefined, { step: 0, total: supportTotal });
			await yieldToRenderer();
			if (generation !== latestSupportsGeneration || supportsCancel.cancelled) {
				throw new SupportCancelledError();
			}
		}
		const params = builder.getLastDieParams();
		const stringParams = builder.getLastStringParams();
		const shell = assembleBlankExportShellGeometry([...faces]);
		const blank = getOrBuildBlankManifold(builder.model.id, [...faces], params, stringParams, {
			source: 'export',
			exportGeometry: shell
		});
		shell.dispose();
		const diePrint = blank.manifold.transform(transformToMat4(printT));
		// Preview draws each support on its own. Export is the path that unions
		// them into one solid.
		const overlay = new Group();
		overlay.name = 'supports-solid';
		supportsOverlay = overlay;
		viewport?.scene.add(overlay);
		try {
			for (const solid of iterateSupportSolids(visible, settings, diePrint, supportsCancel)) {
				if (generation !== latestSupportsGeneration) {
					solid.delete();
					throw new SupportCancelledError();
				}
				overlay.add(meshFromSupportSolid(solid));
				contactCount += 1;
				postProgress(reqId, 'supports-solid', contactCount / supportTotal, undefined, {
					step: contactCount,
					total: supportTotal
				});
				// The offscreen canvas commits when this task yields, so render
				// then return to the event loop before the next support.
				viewport?.composer.render();
				await yieldToRenderer();
				if (generation !== latestSupportsGeneration || supportsCancel.cancelled) {
					throw new SupportCancelledError();
				}
			}
		} finally {
			diePrint.delete();
		}
	}

	// Solid mode already rendered after each support. Placement, and a solid
	// build that produced nothing, still need one frame for the print pose.
	if (mode !== 'solid' || contactCount === 0) {
		viewport?.composer.render();
	}
	post({
		reqId,
		type: 'supportsResult',
		result: {
			generation,
			mode,
			edgeLineCount: visible.edgeLines.length,
			legendPointCount: visible.legendPoints.length,
			contactCount,
			tipPostFinCount: visible.tipPost?.edgeDirs.length ?? 0
		}
	});
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
	// Dice arrive either as a JSON string or as an already-parsed array. The
	// editor and export pages stringify the set with the default replacer, so
	// face offsets are plain `{x, y}` until this reviver restores Vector2s.
	const diceArr = JSON.parse(
		typeof stored.dice === 'string' ? stored.dice : JSON.stringify(stored.dice),
		dieJsonReviver
	) as Dice[];
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
				latestBuildGenerationByDieId.clear();
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
				const latest = latestBuildGenerationByDieId.get(msg.dieId);
				if (latest !== undefined && latest !== msg.generation) {
					// Stale request: resolve quickly without doing the expensive build.
					// The main thread discards stale results via its own generation guard,
					// so metadata content doesn't have to match this skipped build.
					post({
						reqId,
						type: 'buildDone',
						metadata: metadataFromBuilder(builder, die.id, msg.generation)
					});
					break;
				}
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
				const exportGen = latestExportGeneration;
				const named = buildExportMeshesForDie(set, die, idx >= 0 ? idx : 0, {
					includeDice: msg.includeDice,
					optionStates,
					builders,
					onProgress: (phase, frac, label) => postProgress(reqId, phase, frac, label),
					isCancelled: () => exportGen !== latestExportGeneration
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
			case 'buildSupports': {
				try {
					await runBuildSupports(reqId, msg.settingsJson, msg.mode, msg.generation, msg.layersJson);
				} catch (e) {
					if (e instanceof SupportCancelledError) {
						post({
							reqId,
							type: 'supportsResult',
							result: {
								generation: msg.generation,
								mode: msg.mode,
								edgeLineCount: 0,
								legendPointCount: 0,
								contactCount: 0,
								tipPostFinCount: 0
							}
						});
					} else {
						throw e;
					}
				}
				break;
			}
			case 'cancelSupports': {
				latestSupportsGeneration = Math.max(latestSupportsGeneration, msg.generation);
				supportsCancel.cancelled = true;
				post({ reqId, type: 'ok' });
				break;
			}
			case 'setSupportsPreview': {
				supportsPreviewEnabled = msg.enabled;
				if (!msg.enabled) {
					clearSupportsOverlay();
					cachedSupportRegions = undefined;
					cachedSupportsRegionKey = '';
				}
				applySupportsPreviewVisibility();
				post({ reqId, type: 'ok' });
				break;
			}
			case 'clearSupportsPreview': {
				supportsPreviewEnabled = false;
				clearSupportsOverlay();
				cachedSupportRegions = undefined;
				cachedSupportsRegionKey = '';
				applySupportsPreviewVisibility();
				post({ reqId, type: 'ok' });
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
		case 'setSupportsPreview':
		case 'clearSupportsPreview':
		case 'cancelSupports':
			return 15;
		case 'exportDie':
		case 'meshCheck':
		case 'buildSupports':
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
			// A background build runs to completion before the worker can see
			// pointer messages posted during it. Yield when more low-priority
			// work is already queued so those messages enter `pending` and sort
			// ahead of the next build. The visible die (mount) is included so
			// orbiting works before the rest of the set is engraved.
			if (requestPriority(msg) >= 5 && pending.length > 0) {
				await yieldToRenderer();
			}
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
	if (msg.kind === 'buildDie' || msg.kind === 'patchDie') {
		latestBuildGenerationByDieId.set(msg.dieId, msg.generation);
	}
	if (msg.kind === 'buildSupports') {
		latestSupportsGeneration = msg.generation;
		supportsCancel.cancelled = false;
	}
	if (msg.kind === 'cancelSupports') {
		latestSupportsGeneration = Math.max(latestSupportsGeneration, msg.generation);
		supportsCancel.cancelled = true;
	}
	if (msg.kind === 'exportDie') {
		latestExportGeneration += 1;
	}
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
