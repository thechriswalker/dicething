<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Slider from '$lib/components/slider/Slider.svelte';
	import Collapsible from '$lib/components/collapsible/Collapsible.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import { waitForSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import { m } from '$lib/paraglide/messages';
	import { createFancyRender, createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { debounce } from '$lib/utils/debounce';
	import type { BuiltBox, BuildProgress } from '$lib/box/box_builder';
	import { buildBoxInWorker, prepareLayoutInWorker } from '$lib/box/box_client';
	import BoxProgressDie from '$lib/box/BoxProgressDie.svelte';
	import LayoutEditor from '$lib/components/box_layout/LayoutEditor.svelte';
	import type { EditorItem, LayoutResult } from '$lib/components/box_layout/types';
	import {
		defaultBoxConfig,
		loadBoxConfig,
		reconcileBoxConfig,
		saveBoxConfig
	} from '$lib/box/store';
	import {
		applyLayoutEditorParams,
		BOX_PARAM_SLIDER_BOUNDS,
		type BoxConfig,
		type ParamSliderBounds
	} from '$lib/box/types';
	import {
		download,
		exportStlSingle,
		exportStlZip,
		exportThreeMfGrouped,
		exportThreeMfZip,
		type ExportFormat,
		type NamedMesh
	} from '$lib/utils/export';
	import { onDestroy, onMount } from 'svelte';
	import {
		BufferGeometry,
		Group,
		LineBasicMaterial,
		LineLoop,
		Mesh,
		MeshBasicMaterial,
		MeshNormalMaterial,
		MeshPhysicalMaterial,
		Vector3
	} from 'three';
	import {
		ArrowLeft,
		Download,
		Frame,
		SquareDashed,
		LayoutGrid,
		Sparkles,
		Copy,
		Play,
		Package,
		PackageOpen
	} from '@lucide/svelte';
	import { Button } from 'bits-ui';
	import { getLightDarkContext } from '$lib/components/light_switch/light_dark_context';

	const setId = page.params.setId ?? '';

	let setData = $state<DiceSet | undefined>(undefined);
	let config = $state<BoxConfig | undefined>(undefined);
	let ctx = $state<SceneRenderer>();
	let building = $state(false);
	let buildProgress = $state<BuildProgress | null>(null);
	// the build's compute has finished (its result is rendering); combined with
	// the die reaching its final face, drives the brief "linger" before hiding.
	let buildFinished = $state(false);
	// bound from the indicator: true once the die has rotated all the way down to
	// its final face ("1"). The linger only starts once this is true.
	let atFinalFace = $state(false);
	// bound to the indicator's dev "decouple" toggle: while true the indicator
	// stays open (and frozen) so a dev can play with it.
	let progressDecoupled = $state(false);
	// monotonically increasing id of the latest build request, so results from a
	// superseded build (e.g. after a rapid config change) can be dropped.
	let buildSeq = 0;
	let outerSize = $state<{ x: number; y: number }>({ x: 0, y: 0 });

	// user-facing scene control: dice see-through-ness (0 = hidden, 1 = solid).
	let dieOpacity = $state(0.33);
	let fileLayout = $state<'single' | 'zip'>('single');
	let format = $state<ExportFormat>('3mf');

	const gridHelper = createGridHelper(160);

	// Default (non-fancy) look is three's normal material, matching the dice
	// export view's plain mode. The fancy materials below are only used when the
	// fancy toggle is on; the box and dice each get their own colour.
	const normalMat = new MeshNormalMaterial();
	// dice use a plain basic material in regular mode so their opacity can be
	// dialled down (the normal material ignores opacity).
	const dieBasicMat = new MeshBasicMaterial({ color: 0xd8b25a, transparent: true });
	const dieFancyMat = new MeshPhysicalMaterial({
		color: 0xd8b25a,
		roughness: 1.0,
		metalness: 0.25,
		clearcoat: 0.81,
		clearcoatRoughness: 0.5,
		envMapIntensity: 0.9,
		transparent: true
	});

	let built = $state<BuiltBox | undefined>(undefined);
	let previewGroup: Group | undefined;
	let boxMeshes: Array<Mesh> = [];
	let dieMeshes: Array<Mesh> = [];

	// --- lid fold animation -------------------------------------------------
	// the lid is parented to a pivot on the seam/hinge line so it can swing up
	// and over onto the base ("closing the box"). `lidClosedT` is 0 = open flat,
	// 1 = closed; the toggle animates toward 0/1, the slider sets it directly.
	let lidPivot: Group | undefined;
	let lidClosedT = $state(0);
	let lidAnimFrom = 0;
	let lidAnimStart = 0;
	let lidAnimTarget: number | undefined;
	let boxClosed = $state(false);
	const LID_ANIM_MS = 900;

	function applyLidT(t: number) {
		lidClosedT = t;
		if (lidPivot) {
			lidPivot.rotation.x = t * Math.PI;
		}
	}

	function setLidClosedT(t: number) {
		lidAnimTarget = undefined;
		applyLidT(t);
		boxClosed = t > 0.5;
	}

	// developer boundary overlay: per-die footprint, the combined hull, and the
	// box interior outline. Drawn as flat line loops above the seam plane.
	let boundsGroup: Group | undefined;
	const boundMatDie = new LineBasicMaterial({ color: 0x22d3ee, depthTest: false });
	const boundMatCombined = new LineBasicMaterial({ color: 0xfacc15, depthTest: false });
	const boundMatInner = new LineBasicMaterial({ color: 0xf472b6, depthTest: false });

	// --- developer render controls (mirrors the dice export view) ----------
	const prefs = getPreferences();
	let devMode = $derived(prefs.developerMode);
	let showTuning = $derived(prefs.developerMode);
	let fancyRender = $state<ReturnType<typeof createFancyRender>>();
	let fancy = $state(true);
	let wireframeOn = $state(false);
	let showBounds = $state(false);

	let ld = getLightDarkContext()
	let controlPresetClass = $derived(ld?.isLight ? 'preset-filled-surface-200-800' : 'preset-filled-surface-100-900')

	$effect(() => {
		if (!devMode && wireframeOn) {
			wireframeOn = false;
		}
		ctx?.setWireframe(wireframeOn);
	});
	$effect(() => {
		if (!devMode && showBounds) {
			showBounds = false;
		}
	});
	// (re)draw the boundary overlay whenever it's toggled or the box rebuilds.
	$effect(() => {
		void showBounds;
		void built;
		renderBounds();
	});
	// the FPS counter is always shown in developer mode.
	$effect(() => {
		ctx?.setStatsVisible(devMode);
	});

	// dice opacity is a user-facing control; apply it to both render modes. The
	// scene runs a continuous rAF loop, so the change is shown on the next frame
	// (don't call ctx.render() here - that starts a second, compounding loop).
	$effect(() => {
		for (const mat of [dieBasicMat, dieFancyMat]) {
			mat.opacity = dieOpacity;
			// keep transparent always on; toggling it at runtime needs a shader
			// recompile and otherwise leaves the dice rendering opaque.
			mat.transparent = true;
		}
	});

	// tuning panel state; defaults mirror createFancyRender() plus separate base
	// colours for the box shell and the dice.
	let tune = $state({
		boxColour: '#58697e',
		dieColour: '#a3a3a3',
		roughness: 1,
		metalness: 0.07,
		clearcoat: 0.81,
		clearcoatRoughness: 0.5,
		envMapIntensity: 0.9,
		exposure: 1,
		lightIntensity: 0.5,
		lightIntensity2: 1,
		fillIntensity: 0,
		aoRadius: 2.5,
		aoScale: 0,
		aoThickness: 1,
		aoDistanceExponent: 1
	});
	$effect(() => {
		const fr = fancyRender;
		if (!fr || !ctx) {
			return;
		}
		fr.material.color.set(tune.boxColour);
		dieFancyMat.color.set(tune.dieColour);
		dieBasicMat.color.set(tune.dieColour);
		for (const mat of [fr.material, dieFancyMat]) {
			mat.roughness = tune.roughness;
			mat.metalness = tune.metalness;
			mat.clearcoat = tune.clearcoat;
			mat.clearcoatRoughness = tune.clearcoatRoughness;
			mat.envMapIntensity = tune.envMapIntensity;
		}
		ctx.renderer.toneMappingExposure = tune.exposure;
		fr.keyLight.intensity = tune.lightIntensity;
		fr.keyLight2.intensity = tune.lightIntensity2;
		fr.fillLight.intensity = tune.fillIntensity;
		fr.ao.updateGtaoMaterial({
			radius: tune.aoRadius,
			scale: tune.aoScale,
			thickness: tune.aoThickness,
			distanceExponent: tune.aoDistanceExponent
		});
	});

	onMount(async () => {
		setData = await waitForSet(setId);
		if (!setData) {
			goto('/boxes');
			return;
		}
		const existing = loadBoxConfig(setId);
		config = existing
			? reconcileBoxConfig(existing, setData.dice)
			: defaultBoxConfig(setId, setData.dice);
	});

	const sceneReady = (_ctx: SceneRenderer) => {
		ctx = _ctx;
		// top-down view: look straight down the box's height axis. up = -Z so the
		// footprint depth reads as screen vertical (lid above base).
		_ctx.camera.up.set(0, 0, -1);
		_ctx.camera.position.set(0, 180, 0);
		_ctx.camera.lookAt(0, 0, 0);
		fancyRender = createFancyRender(_ctx);
		fancyRender.setEnabled(fancy);
		_ctx.onBeforeRender(stepLidAnim);
		_ctx.render();
	};

	// ease the lid pivot towards its target each frame (the scene runs a
	// continuous rAF loop, so this is all the animation needs).
	function stepLidAnim() {
		if (!lidPivot || lidAnimTarget === undefined) {
			return;
		}
		const target = lidAnimTarget;
		if (Math.abs(lidClosedT - target) < 1e-4) {
			applyLidT(target);
			lidAnimTarget = undefined;
			boxClosed = target > 0.5;
			return;
		}
		const t = Math.min(1, (performance.now() - lidAnimStart) / LID_ANIM_MS);
		// easeInOutQuad
		const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
		applyLidT(lidAnimFrom + (target - lidAnimFrom) * e);
		if (t >= 1) {
			applyLidT(target);
			lidAnimTarget = undefined;
			boxClosed = target > 0.5;
		}
	}

	function toggleClosed() {
		lidAnimFrom = lidClosedT;
		lidAnimTarget = lidClosedT < 0.5 ? 1 : 0;
		boxClosed = lidAnimTarget > 0.5;
		lidAnimStart = performance.now();
	}

	function toggleFancy() {
		fancy = !fancy;
		fancyRender?.setEnabled(fancy);
		gridHelper.visible = !fancy;
		applyMaterials();
	}

	// Copy the current tuning values as the `let tune = $state({...})` initialiser
	// so they can be pasted straight back into this file to bless new defaults.
	let copiedTuning = $state(false);
	async function copyTuning() {
		const lines = [
			`\tboxColour: '${tune.boxColour}',`,
			`\tdieColour: '${tune.dieColour}',`,
			`\troughness: ${tune.roughness},`,
			`\tmetalness: ${tune.metalness},`,
			`\tclearcoat: ${tune.clearcoat},`,
			`\tclearcoatRoughness: ${tune.clearcoatRoughness},`,
			`\tenvMapIntensity: ${tune.envMapIntensity},`,
			`\texposure: ${tune.exposure},`,
			`\tlightIntensity: ${tune.lightIntensity},`,
			`\tlightIntensity2: ${tune.lightIntensity2},`,
			`\tfillIntensity: ${tune.fillIntensity},`,
			`\taoRadius: ${tune.aoRadius},`,
			`\taoScale: ${tune.aoScale},`,
			`\taoThickness: ${tune.aoThickness},`,
			`\taoDistanceExponent: ${tune.aoDistanceExponent}`
		];
		const snippet = `let tune = $state({\n${lines.join('\n')}\n});`;
		try {
			await navigator.clipboard.writeText(snippet);
			copiedTuning = true;
			setTimeout(() => (copiedTuning = false), 1500);
		} catch (e) {
			console.error('failed to copy tuning', e);
		}
	}

	// Box shell and dice each get their own fancy material (with its own colour);
	// when fancy is off everything reverts to the plain normal material.
	function applyMaterials() {
		const boxMat = fancy && fancyRender ? fancyRender.material : normalMat;
		const dieMat = fancy ? dieFancyMat : dieBasicMat;
		for (const mesh of boxMeshes) {
			mesh.material = boxMat;
		}
		for (const mesh of dieMeshes) {
			mesh.material = dieMat;
		}
	}

	function disposeGroup(g: Group | undefined) {
		if (!g) {
			return;
		}
		g.traverse((o) => {
			const mesh = o as Mesh;
			if (mesh.isMesh) {
				mesh.geometry?.dispose();
			}
		});
		ctx?.scene.remove(g);
	}

	// run the (expensive) CSG and cache the result, then draw it.
	async function rebuild() {
		if (!ctx || !setData || !config) {
			return;
		}
		const seq = ++buildSeq;
		buildProgress = null;
		buildFinished = false;
		atFinalFace = false;
		progressDecoupled = false;
		// Most builds are fast; only surface the progress indicator once a build
		// has been running long enough to be worth showing (e.g. a complex edged
		// coin), so quick rebuilds don't flash it on and off.
		const showTimer = setTimeout(() => {
			if (seq === buildSeq) {
				building = true;
			}
		}, 100);
		try {
			const result = await buildBoxInWorker(setData, $state.snapshot(config) as BoxConfig, (p) => {
				// ignore progress from a build that's already been superseded.
				if (seq === buildSeq) {
					buildProgress = p;
				}
			});
			// a newer build started while this one ran: drop the stale result.
			if (seq !== buildSeq) {
				return;
			}
			built = result;
			outerSize = { x: result.outer.x, y: result.outer.y };
			renderPreview();
		} catch (e) {
			console.error('failed to build box', e);
		} finally {
			clearTimeout(showTimer);
			// mark the build done; the hideIndicator effect lingers briefly then
			// hides it (or keeps it open while a dev has decoupled the indicator).
			if (seq === buildSeq) {
				buildFinished = true;
			}
		}
	}

	// Hide the progress indicator a short beat AFTER the build has finished AND
	// the die has rolled all the way down to its final face ("1") - so the linger
	// starts when the die hits 1, not when the compute ends. Unless a dev has
	// decoupled it to play with, in which case it stays open until re-coupled.
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (building && buildFinished && atFinalFace && !progressDecoupled) {
			hideTimer = setTimeout(() => {
				building = false;
				buildProgress = null;
				buildFinished = false;
			}, 200);
			return () => clearTimeout(hideTimer);
		}
	});

	// dev-only: replay a synthetic progress sequence so the loading indicator can
	// be watched without waiting for a real (slow) build.
	let previewTimer: ReturnType<typeof setInterval> | undefined;
	onDestroy(() => clearInterval(previewTimer));
	function previewLoading() {
		const seq = ++buildSeq;
		const totalSteps = 12;
		building = true;
		buildFinished = false;
		atFinalFace = false;
		progressDecoupled = false;
		buildProgress = { step: 0, totalSteps, phase: 'prepare', label: '' };
		let step = 0;
		clearInterval(previewTimer);
		previewTimer = setInterval(() => {
			// a real build (or another preview) took over: stop.
			if (seq !== buildSeq) {
				clearInterval(previewTimer);
				return;
			}
			step++;
			const phase: BuildProgress['phase'] =
				step >= totalSteps ? 'lid' : step === totalSteps - 1 ? 'base' : 'prepare';
			buildProgress = { step, totalSteps, phase, label: '' };
			if (step >= totalSteps) {
				clearInterval(previewTimer);
				// hand off to the hideIndicator effect (which honours decouple).
				buildFinished = true;
			}
		}, 650);
	}

	// (re)draw the cached box honouring the visibility toggles. Cheap: no CSG.
	function renderPreview() {
		if (!ctx || !built) {
			return;
		}
		disposeGroup(previewGroup);
		// the box is built Z-up (print frame); the preview is viewed top-down (the
		// camera looks straight down the box's height axis). The -90deg X rotation
		// stands the box up so its seam faces - the cavities - point at the camera.
		const root = new Group();
		root.rotation.x = -Math.PI / 2;
		boxMeshes = [];
		dieMeshes = [];

		// lay the two halves side by side in the footprint plane (along the box's
		// Y, which reads as vertical in the top-down view) so they read top/bottom.
		// A hinged box sits its halves a parting gap apart so the barrels are coaxial.
		const gap = built.hinge ? built.hinge.partingGap : 8;
		const offset = (built.outer.y + gap) / 2;

		{
			const g = new Group();
			g.position.set(0, -offset, 0);
			const baseMesh = new Mesh(built.base, normalMat);
			g.add(baseMesh);
			boxMeshes.push(baseMesh);
			for (const d of built.placedDice) {
				if (d.half === 'base') {
					const dm = new Mesh(d.geometry, normalMat);
					g.add(dm);
					dieMeshes.push(dm);
				}
			}
			root.add(g);
		}
		{
			// the lid hangs off a pivot on the hinge pin/barrel axis so toggling
			// `boxClosed` swings it up and over onto the base.
			const pivotZ = built.hinge?.axisZ ?? built.baseHeight;
			const pivot = new Group();
			pivot.position.set(0, 0, pivotZ);
			const g = new Group();
			g.position.set(0, offset, -pivotZ);
			const lidMesh = new Mesh(built.lid, normalMat);
			g.add(lidMesh);
			boxMeshes.push(lidMesh);
			for (const d of built.placedDice) {
				if (d.half === 'lid') {
					const dm = new Mesh(d.geometry, normalMat);
					g.add(dm);
					dieMeshes.push(dm);
				}
			}
			pivot.add(g);
			pivot.rotation.x = lidClosedT * Math.PI;
			root.add(pivot);
			lidPivot = pivot;
		}

		applyMaterials();
		ctx.scene.add(root);
		previewGroup = root;
	}

	function clearBounds() {
		if (!boundsGroup) {
			return;
		}
		boundsGroup.traverse((o) => {
			const l = o as LineLoop;
			if (l.isLineLoop) {
				l.geometry?.dispose();
			}
		});
		ctx?.scene.remove(boundsGroup);
		boundsGroup = undefined;
	}

	function boundLoop(
		poly: Array<{ x: number; y: number }>,
		ySign: number,
		z: number,
		mat: LineBasicMaterial
	) {
		const pts = poly.map((p) => new Vector3(p.x, ySign * p.y, z));
		const loop = new LineLoop(new BufferGeometry().setFromPoints(pts), mat);
		loop.renderOrder = 999;
		return loop;
	}

	// Draw the boundary overlay. The outlines come from buildBox in the box xy
	// frame (centred); they're placed on each half exactly like the dice - the
	// lid half is Y-mirrored - and sit just above the seam so they read on top.
	function renderBounds() {
		clearBounds();
		if (!ctx || !built || !showBounds) {
			return;
		}
		const root = new Group();
		root.rotation.x = -Math.PI / 2;
		const gap = built.hinge ? built.hinge.partingGap : 8;
		const offset = (built.outer.y + gap) / 2;
		const z = built.baseHeight + 0.5;
		for (const { yoff, ySign } of [
			{ yoff: -offset, ySign: 1 },
			{ yoff: offset, ySign: -1 }
		]) {
			const g = new Group();
			g.position.set(0, yoff, 0);
			for (const poly of built.boundaries.dice) {
				g.add(boundLoop(poly, ySign, z, boundMatDie));
			}
			g.add(boundLoop(built.boundaries.combined, ySign, z, boundMatCombined));
			g.add(boundLoop(built.boundaries.inner, ySign, z, boundMatInner));
			root.add(g);
		}
		ctx.scene.add(root);
		boundsGroup = root;
	}

	const scheduleRebuild = debounce<void>(200, () => rebuild());

	// persist + rebuild whenever the config changes.
	let configSig = $derived(config ? JSON.stringify(config) : '');
	$effect(() => {
		JSON.stringify([configSig]);
		if (ctx && setData && config) {
			saveBoxConfig($state.snapshot(config) as BoxConfig);
			scheduleRebuild();
		}
	});

	function setParam<K extends keyof BoxConfig['params']>(key: K, value: BoxConfig['params'][K]) {
		if (!config) {
			return;
		}
		config.params[key] = value;
	}

	function setMagnet<K extends keyof BoxConfig['params']['magnets']>(
		key: K,
		value: BoxConfig['params']['magnets'][K]
	) {
		if (!config) {
			return;
		}
		config.params.magnets[key] = value;
	}

	function setHinge(value: boolean) {
		if (!config) {
			return;
		}
		config.params.hinge.enabled = value;
		// a hinged box only needs magnets on the opening side; drop a 4-magnet
		// box to the opening pair when the hinge is switched on.
		if (value && config.params.magnets.count > 2) {
			config.params.magnets.count = 2;
		}
	}

	function setHingeParam<K extends keyof BoxConfig['params']['hinge']>(
		key: K,
		value: BoxConfig['params']['hinge'][K]
	) {
		if (!config) {
			return;
		}
		config.params.hinge[key] = value;
	}

	let orderedPlacements = $derived(
		config ? [...config.placements].sort((a, b) => a.order - b.order) : []
	);

	let anyIncluded = $derived(orderedPlacements.some((p) => p.include));

	// --- 2D layout editor ---------------------------------------------------
	let layoutOpen = $state(false);
	let layoutLoading = $state(false);
	let editorItems = $state<Array<EditorItem>>([]);
	let editorBox = $state<{ halfX: number; halfY: number }>({ halfX: 0, halfY: 0 });

	function dieLabel(kind: string): string {
		return m.dice_name({ kind });
	}

	async function openLayout() {
		if (!setData || !config) {
			return;
		}
		layoutLoading = true;
		try {
			const prep = await prepareLayoutInWorker(setData, $state.snapshot(config) as BoxConfig);
			const manual = config.params.manual && config.params.box.halfX > 0;
			const byId = new Map(config.placements.map((pl) => [pl.dieId, pl]));
			editorItems = prep.dice.map((d) => {
				const pl = byId.get(d.dieId);
				return {
					dieId: d.dieId,
					kind: d.kind,
					hull0: d.hull0,
					size: d.size,
					x: manual ? (pl?.x ?? d.autoPos.x) : d.autoPos.x,
					y: manual ? (pl?.y ?? d.autoPos.y) : d.autoPos.y,
					rotation: pl?.rotation ?? 0,
					include: d.include
				};
			});
			editorBox =
				manual && config.params.box.halfX > 0
					? { halfX: config.params.box.halfX, halfY: config.params.box.halfY }
					: prep.box;
			layoutOpen = true;
		} catch (e) {
			console.error('failed to prepare layout', e);
		} finally {
			layoutLoading = false;
		}
	}

	function applyLayout(result: LayoutResult) {
		if (!config) {
			return;
		}
		const byId = new Map(result.placements.map((p) => [p.dieId, p]));
		for (const pl of config.placements) {
			const r = byId.get(pl.dieId);
			if (r) {
				pl.x = r.x;
				pl.y = r.y;
				pl.rotation = r.rotation;
				pl.include = r.include;
			}
		}
		config.params.box = { halfX: result.box.halfX, halfY: result.box.halfY };
		config.params.manual = true;
		config.params = applyLayoutEditorParams(config.params, result.layoutParams, result.shape);
		layoutOpen = false;
	}

	async function exportBox() {
		if (!built) {
			return;
		}
		const name = (setData?.name || 'set').replace(/[^a-z0-9-_]+/gi, '_');
		const threemfOpts =
			format === '3mf' && built.magnetPauseZ !== undefined
				? { magnetPauseZ: built.magnetPauseZ }
				: undefined;
		// a print-in-place hinge must print as ONE interlocked, open-flat piece:
		// the two halves meet on the seam line so their barrels are coaxial and
		// the pin threads the base bores. Force a single file in that layout.
		if (built.hinge) {
			// halves sit a parting gap apart so their barrels are coaxial.
			const halfOffset = built.outer.y / 2 + built.hinge.partingGap / 2;
			const base = new Mesh(built.base.clone(), normalMat);
			const lid = new Mesh(built.lid.clone(), normalMat);
			base.geometry.translate(0, -halfOffset, 0);
			lid.geometry.translate(0, halfOffset, 0);
			if (format === '3mf') {
				const named: Array<NamedMesh> = [
					{ name: `${name}_box_base`, mesh: base, group: 'box' },
					{ name: `${name}_box_lid`, mesh: lid, group: 'box' }
				];
				// base + lid are one print-in-place piece: keep them as a single
				// grouped 3MF object so the slicer never treats them as two parts.
				download(
					await exportThreeMfGrouped([{ name: `${name}_box`, meshes: named }], 'z', threemfOpts),
					`${name}_box.3mf`
				);
			} else {
				download(exportStlSingle([base, lid]), `${name}_box.stl`);
			}
			return;
		}
		if (fileLayout === 'zip') {
			const named: Array<NamedMesh> = [
				{ name: `${name}_box_base`, mesh: new Mesh(built.base.clone(), normalMat), group: 'box' },
				{ name: `${name}_box_lid`, mesh: new Mesh(built.lid.clone(), normalMat), group: 'box' }
			];
			// the box is already built Z-up, so no reorientation for 3MF.
			if (format === '3mf') {
				download(await exportThreeMfZip(named, 'z', threemfOpts), `${name}_box.zip`);
			} else {
				download(exportStlZip(named), `${name}_box.zip`);
			}
		} else {
			const base = new Mesh(built.base.clone(), normalMat);
			const lid = new Mesh(built.lid.clone(), normalMat);
			// place side by side so they don't overlap in one file (Z-up frame).
			lid.geometry.translate(built.outer.x + 8, 0, 0);
			if (format === '3mf') {
				const named: Array<NamedMesh> = [
					{ name: `${name}_box_base`, mesh: base, group: 'box' },
					{ name: `${name}_box_lid`, mesh: lid, group: 'box' }
				];
				// the base and lid are halves of one box: group them into a single
				// 3MF object rather than two independent build items.
				download(
					await exportThreeMfGrouped([{ name: `${name}_box`, meshes: named }], 'z', threemfOpts),
					`${name}_box.3mf`
				);
			} else {
				download(exportStlSingle([base, lid]), `${name}_box.stl`);
			}
		}
	}
</script>

	{#snippet header()}
		<a class="btn preset-tonal-surface" href="/boxes" aria-label={m.boxes_back_to_sets()}>
			<ArrowLeft class="size-4" />
		</a>
		<p class="text-primary-500 h4">{m.boxes_title()} — {setData?.name}</p>
	{/snippet}

	<div class="flex h-full flex-row gap-4 p-4">
		<Scene class="relative h-full grow" {sceneReady}>
			<ul class="absolute top-2 left-2 flex flex-col gap-2">
				<li class="card {controlPresetClass} flex w-56 flex-col gap-1 p-2 text-sm">
					<span class="flex justify-between">
						<span>{m.boxes_tuning_die_opacity()}</span>
						<span>{Math.round(dieOpacity * 100)}%</span>
					</span>
					<Slider
						class="py-1"
						value={dieOpacity}
						min={0}
						max={1}
						step={0.01}
						onChange={(v) => (dieOpacity = v)}
					/>
				</li>
				{#if built}
					<li class="card {controlPresetClass} flex w-56 flex-col gap-1 p-2 text-sm">
						<span class="flex justify-between" title={m.boxes_lid_position_hint()}>
							<span>{m.boxes_hinge_position()}</span>
							<span class="text-surface-600-400 tabular-nums">{Math.round(lidClosedT * 100)}%</span>
						</span>
						<div class="flex items-center gap-2">
							<Tooltip content={boxClosed ? m.boxes_open_box() : m.boxes_close_box()} side="right">
								{#snippet children(props)}
									<Button.Root
										{...props}
										class={'btn-icon shrink-0 ' +
											(boxClosed ? 'preset-filled-primary-500' : 'preset-tonal-primary')}
										aria-label={boxClosed ? m.boxes_open_box() : m.boxes_close_box()}
										aria-pressed={boxClosed}
										onclick={toggleClosed}
										>{#if boxClosed}<Package />{:else}<PackageOpen />{/if}</Button.Root
									>
								{/snippet}
							</Tooltip>
							<Slider
								class="min-w-0 flex-1 py-1"
								value={lidClosedT}
								min={0}
								max={1}
								step={0.01}
								onChange={setLidClosedT}
							/>
						</div>
					</li>
				{/if}
				<li><div class="card {controlPresetClass} inline-flex gap-2 p-2">
					<Tooltip content={m.controls_toggle_fancy_render()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class={'btn-icon ' + (fancy ? 'preset-filled-primary-500' : 'preset-tonal-primary')}
								aria-label={m.controls_toggle_fancy_render()}
								aria-pressed={fancy}
								onclick={toggleFancy}><Sparkles /></Button.Root
							>
						{/snippet}
					</Tooltip>
					{#if devMode}
						<Tooltip content={m.controls_toggle_wireframe()} side="right">
							{#snippet children(props)}
								<Button.Root
									{...props}
									class={'btn-icon ' +
										(wireframeOn ? 'preset-filled-secondary-500' : 'preset-tonal-primary')}
									aria-label={m.controls_toggle_wireframe()}
									aria-pressed={wireframeOn}
									onclick={() => {
										wireframeOn = !wireframeOn;
									}}><Frame /></Button.Root
								>
							{/snippet}
						</Tooltip>
						<Tooltip content={m.boxes_toggle_bounds()} side="right">
							{#snippet children(props)}
								<Button.Root
									{...props}
									class={'btn-icon ' +
										(showBounds ? 'preset-filled-secondary-500' : 'preset-tonal-primary')}
									aria-label={m.boxes_toggle_bounds()}
									aria-pressed={showBounds}
									onclick={() => {
										showBounds = !showBounds;
									}}><SquareDashed /></Button.Root
								>
							{/snippet}
						</Tooltip>
						<Tooltip content={m.boxes_preview_loading()} side="right">
							{#snippet children(props)}
								<Button.Root
									{...props}
									class="btn-icon preset-tonal-primary"
									aria-label={m.boxes_preview_loading()}
									onclick={previewLoading}><Play /></Button.Root
								>
							{/snippet}
						</Tooltip>
					{/if}
				</div></li>
				{#if building}
					<li>
						<BoxProgressDie
							progress={buildProgress}
							showDevTools={devMode}
							complete={buildFinished}
							bind:decoupled={progressDecoupled}
							bind:atFinalFace
						/>
					</li>
				{/if}
			</ul>
		</Scene>

		<div class="card preset-tonal-surface flex w-80 shrink-0 flex-col gap-3 overflow-y-auto p-4">
			{#if config}
				{#if built && !built.closure.ok}
					<p class="text-warning-500 text-sm">{m.boxes_closure_warning()}</p>
				{/if}
				{#snippet sliderRow(
					label: string,
					value: number,
					bounds: ParamSliderBounds,
					set: (v: number) => void,
					unit = m.boxes_unit_mm()
				)}
					<div class="flex flex-col">
						<span class="flex justify-between text-sm">
							<span>{label}</span>
							<span>{value}{unit ? ' ' + unit : ''}</span>
						</span>
						<Slider class="py-1" {value} {...bounds} onChange={set} />
					</div>
				{/snippet}

				{#snippet tuneRow(
					label: string,
					value: number,
					min: number,
					max: number,
					step: number,
					set: (v: number) => void
				)}
					<div class="flex flex-col">
						<span class="flex justify-between text-xs">
							<span>{label}</span>
							<span>{value.toFixed(2)}</span>
						</span>
						<Slider class="py-1" {value} {min} {max} {step} onChange={set} />
					</div>
				{/snippet}

				<p class="text-surface-600-400 text-xs">
					{m.boxes_outer_size({ x: outerSize.x.toFixed(1), y: outerSize.y.toFixed(1) })}
				</p>
				<p class="text-surface-600-400 text-xs">{m.boxes_seam_hint()}</p>

				<Collapsible title={m.boxes_section_dimensions()}>
					<div class="flex flex-col gap-2 pt-2">
						{@render sliderRow(m.boxes_wall(), config.params.wall, BOX_PARAM_SLIDER_BOUNDS.wall, (v) =>
							setParam('wall', v)
						)}
						{@render sliderRow(
							m.boxes_floor(),
							config.params.floor,
							BOX_PARAM_SLIDER_BOUNDS.floor,
							(v) => setParam('floor', v)
						)}
						{@render sliderRow(
							m.boxes_chamfer(),
							config.params.chamfer,
							BOX_PARAM_SLIDER_BOUNDS.chamfer,
							(v) => setParam('chamfer', v)
						)}
						<p class="text-surface-600-400 text-xs">{m.boxes_chamfer_hint()}</p>
						{@render sliderRow(
							m.boxes_bevel(),
							config.params.bevel,
							BOX_PARAM_SLIDER_BOUNDS.bevel,
							(v) => setParam('bevel', v)
						)}
						<p class="text-surface-600-400 text-xs">{m.boxes_bevel_hint()}</p>
						{@render sliderRow(
							m.boxes_tray_depth_base(),
							config.params.trayDepthBase,
							BOX_PARAM_SLIDER_BOUNDS.trayDepthBase,
							(v) => setParam('trayDepthBase', v)
						)}
						{@render sliderRow(
							m.boxes_tray_depth_lid(),
							config.params.trayDepthLid,
							BOX_PARAM_SLIDER_BOUNDS.trayDepthLid,
							(v) => setParam('trayDepthLid', v)
						)}
						<p class="text-surface-600-400 text-xs">{m.boxes_tray_depth_hint()}</p>
					</div>
				</Collapsible>

				<Collapsible title={m.boxes_section_cavities()}>
					<div class="flex flex-col gap-2 pt-2">
						{@render sliderRow(
							m.boxes_cavity_tolerance(),
							config.params.cavityTolerance,
							BOX_PARAM_SLIDER_BOUNDS.cavityTolerance,
							(v) => setParam('cavityTolerance', v)
						)}
						{@render sliderRow(
							m.boxes_cavity_bevel(),
							config.params.cavityBevel,
							BOX_PARAM_SLIDER_BOUNDS.cavityBevel,
							(v) => setParam('cavityBevel', v)
						)}
						<p class="text-surface-600-400 text-xs">{m.boxes_cavity_bevel_hint()}</p>
					</div>
				</Collapsible>

				<Collapsible title={m.boxes_section_magnets()}>
					<div class="flex flex-col gap-2 pt-2">
						<p class="text-surface-600-400 text-xs">{m.boxes_magnets_hint()}</p>
						<label class="flex items-center justify-between gap-2 text-sm">
							<span>{m.boxes_magnets_enabled()}</span>
							<input
								type="checkbox"
								class="checkbox"
								checked={config.params.magnets.enabled}
								onchange={(e) => setMagnet('enabled', e.currentTarget.checked)}
							/>
						</label>
						{#if config.params.magnets.enabled}
							<div class="flex flex-col">
								<span class="flex justify-between text-sm">
									<span>{m.boxes_magnet_count()}</span>
									<span>{config.params.magnets.count}</span>
								</span>
								<Slider
									class="py-1"
									value={config.params.magnets.count}
									{...BOX_PARAM_SLIDER_BOUNDS.magnets.count}
									onChange={(v) => setMagnet('count', v)}
								/>
							</div>
							<div class="flex flex-col gap-1">
								<span class="text-sm">{m.boxes_magnet_mode()}</span>
								<div class="flex gap-2">
									<label class="flex items-center gap-1 text-sm">
										<input
											type="radio"
											class="radio"
											checked={config.params.magnets.mode === 'pushin'}
											onchange={() => setMagnet('mode', 'pushin')}
										/>
										<span>{m.boxes_magnet_pushin()}</span>
									</label>
									<label class="flex items-center gap-1 text-sm">
										<input
											type="radio"
											class="radio"
											checked={config.params.magnets.mode === 'printin'}
											onchange={() => setMagnet('mode', 'printin')}
										/>
										<span>{m.boxes_magnet_printin()}</span>
									</label>
								</div>
							</div>
							{@render sliderRow(
								m.boxes_magnet_diameter(),
								config.params.magnets.diameter,
								BOX_PARAM_SLIDER_BOUNDS.magnets.diameter,
								(v) => setMagnet('diameter', v)
							)}
							{@render sliderRow(
								m.boxes_magnet_thickness(),
								config.params.magnets.thickness,
								BOX_PARAM_SLIDER_BOUNDS.magnets.thickness,
								(v) => setMagnet('thickness', v)
							)}
							{@render sliderRow(
								m.boxes_magnet_tolerance(),
								config.params.magnets.tolerance,
								BOX_PARAM_SLIDER_BOUNDS.magnets.tolerance,
								(v) => setMagnet('tolerance', v)
							)}
						{/if}

						<label class="flex items-center justify-between gap-2 text-sm">
							<span>{m.boxes_hinge_enabled()}</span>
							<input
								type="checkbox"
								class="checkbox"
								checked={config.params.hinge.enabled}
								onchange={(e) => setHinge(e.currentTarget.checked)}
							/>
						</label>
						<p class="text-surface-600-400 text-xs">{m.boxes_hinge_hint()}</p>
						{#if devMode && config.params.hinge.enabled}
							<p class="text-surface-600-400 text-xs font-semibold">{m.boxes_hinge_dev_title()}</p>
							{@render sliderRow(
								m.boxes_hinge_pin_radius(),
								config.params.hinge.pinRadius,
								BOX_PARAM_SLIDER_BOUNDS.hinge.pinRadius,
								(v) => setHingeParam('pinRadius', v)
							)}
							{@render sliderRow(
								m.boxes_hinge_barrel_radius(),
								config.params.hinge.barrelRadius,
								BOX_PARAM_SLIDER_BOUNDS.hinge.barrelRadius,
								(v) => setHingeParam('barrelRadius', v)
							)}
							{@render sliderRow(
								m.boxes_hinge_clearance(),
								config.params.hinge.clearance,
								BOX_PARAM_SLIDER_BOUNDS.hinge.clearance,
								(v) => setHingeParam('clearance', v)
							)}
							{@render sliderRow(
								m.boxes_hinge_knuckles(),
								config.params.hinge.knuckles,
								BOX_PARAM_SLIDER_BOUNDS.hinge.knuckles,
								(v) => setHingeParam('knuckles', v),
								''
							)}
							{@render sliderRow(
								m.boxes_hinge_knuckle_width(),
								config.params.hinge.knuckleWidth,
								BOX_PARAM_SLIDER_BOUNDS.hinge.knuckleWidth,
								(v) => setHingeParam('knuckleWidth', v)
							)}
							{@render sliderRow(
								m.boxes_hinge_indent(),
								config.params.hinge.indent,
								BOX_PARAM_SLIDER_BOUNDS.hinge.indent,
								(v) => setHingeParam('indent', v)
							)}
						{/if}
					</div>
				</Collapsible>

				<Collapsible title={m.boxes_section_dice()}>
					<div class="flex flex-col gap-2 pt-2">
						<p class="text-surface-600-400 text-xs">
							{m.boxes_dice_summary({
								included: orderedPlacements.filter((p) => p.include).length,
								total: orderedPlacements.length
							})}
						</p>
						<button
							class="btn preset-tonal-primary mt-1"
							disabled={orderedPlacements.length === 0 || layoutLoading}
							onclick={openLayout}
						>
							<LayoutGrid class="size-4" />
							<span>{layoutLoading ? m.boxes_layout_loading() : m.boxes_layout_edit()}</span>
						</button>
					</div>
				</Collapsible>

				<Collapsible title={m.boxes_section_export()}>
					<div class="flex flex-col gap-2 pt-2">
						<label class="flex flex-col gap-1">
							<span class="text-sm">{m.export_format()}</span>
							<select class="select" bind:value={format}>
								<option value="stl">STL</option>
								<option value="3mf">3MF</option>
							</select>
						</label>
						{#if built?.hinge}
							<p class="text-surface-600-400 text-xs">{m.boxes_hinge_export_note()}</p>
						{:else}
							<label class="flex items-center gap-2 text-sm">
								<input type="radio" class="radio" value="zip" bind:group={fileLayout} />
								<span>{m.boxes_export_zip()}</span>
							</label>
							<label class="flex items-center gap-2 text-sm">
								<input type="radio" class="radio" value="single" bind:group={fileLayout} />
								<span>{m.boxes_export_single()}</span>
							</label>
						{/if}
						{#if !anyIncluded}
							<p class="text-warning-600-400 text-sm">{m.boxes_nothing()}</p>
						{/if}
						<button
							class="btn preset-filled-primary-500"
							disabled={!built || building}
							onclick={exportBox}
						>
							<Download class="size-4" />
							{m.boxes_export_button()}
						</button>
					</div>
				</Collapsible>

				{#if showTuning}
					<Collapsible defaultOpen={false} title={m.export_render_tuning_title()}>
						<div class="flex flex-col gap-2 pt-2">
							<p class="text-surface-600-400 text-xs">{m.export_render_tuning_hint()}</p>
							<button type="button" class="btn btn-sm preset-tonal-primary" onclick={copyTuning}>
								<Copy class="size-4" />
								<span>{copiedTuning ? m.boxes_tuning_copied() : m.boxes_tuning_copy()}</span>
							</button>
							<span class="text-sm font-semibold">{m.export_render_tuning_base_colour()}</span>
							<label class="flex items-center justify-between text-xs">
								<span>{m.boxes_tuning_box_colour()}</span>
								<input type="color" class="h-6 w-10 rounded" bind:value={tune.boxColour} />
							</label>
							<label class="flex items-center justify-between text-xs">
								<span>{m.boxes_tuning_die_colour()}</span>
								<input type="color" class="h-6 w-10 rounded" bind:value={tune.dieColour} />
							</label>
							<span class="text-sm font-semibold">{m.export_render_tuning_material()}</span>
							{@render tuneRow(
								m.export_render_tuning_roughness(),
								tune.roughness,
								0,
								1,
								0.01,
								(v) => (tune.roughness = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_metalness(),
								tune.metalness,
								0,
								1,
								0.01,
								(v) => (tune.metalness = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_clearcoat(),
								tune.clearcoat,
								0,
								1,
								0.01,
								(v) => (tune.clearcoat = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_clearcoat_rough(),
								tune.clearcoatRoughness,
								0,
								1,
								0.01,
								(v) => (tune.clearcoatRoughness = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_env_intensity(),
								tune.envMapIntensity,
								0,
								3,
								0.05,
								(v) => (tune.envMapIntensity = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_exposure(),
								tune.exposure,
								0,
								3,
								0.05,
								(v) => (tune.exposure = v)
							)}
							<span class="text-sm font-semibold">{m.export_render_tuning_lighting()}</span>
							{@render tuneRow(
								m.export_render_tuning_key_light(),
								tune.lightIntensity,
								0,
								12,
								0.1,
								(v) => (tune.lightIntensity = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_key_light_2(),
								tune.lightIntensity2,
								0,
								12,
								0.1,
								(v) => (tune.lightIntensity2 = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_fill(),
								tune.fillIntensity,
								0,
								5,
								0.05,
								(v) => (tune.fillIntensity = v)
							)}
							<span class="text-sm font-semibold">{m.export_render_tuning_ao()}</span>
							{@render tuneRow(
								m.export_render_tuning_ao_radius(),
								tune.aoRadius,
								0,
								10,
								0.1,
								(v) => (tune.aoRadius = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_ao_scale(),
								tune.aoScale,
								0,
								3,
								0.05,
								(v) => (tune.aoScale = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_ao_thickness(),
								tune.aoThickness,
								0,
								3,
								0.05,
								(v) => (tune.aoThickness = v)
							)}
							{@render tuneRow(
								m.export_render_tuning_ao_dist_exp(),
								tune.aoDistanceExponent,
								0.1,
								4,
								0.05,
								(v) => (tune.aoDistanceExponent = v)
							)}
						</div>
					</Collapsible>
				{/if}
			{/if}
		</div>
	</div>

	{#if config}
		<LayoutEditor
			open={layoutOpen}
			initialItems={editorItems}
			initialBox={editorBox}
			params={config.params}
			{dieLabel}
			onApply={applyLayout}
			onClose={() => (layoutOpen = false)}
		/>
	{/if}
