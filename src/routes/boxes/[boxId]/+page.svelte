<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Slider from '$lib/components/slider/Slider.svelte';
	import Collapsible from '$lib/components/collapsible/Collapsible.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import { waitForSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { getPreferences, setPreference } from '$lib/interfaces/preferences.svelte';
	import { m } from '$lib/paraglide/messages';
	import { dieListLabel } from '$lib/utils/die_display_name';
	import dice from '$lib/dice';
	import { createFancyRender, createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { debounce } from '$lib/utils/debounce';
	import type { BuiltBox, BuildProgress } from '$lib/box/box_builder';
	import { buildBoxInWorker, prepareLayoutInWorker } from '$lib/box/box_client';
	import BoxProgressDie from '$lib/box/BoxProgressDie.svelte';
	import LayoutEditor from '$lib/components/box_layout/LayoutEditor.svelte';
	import type { EditorItem, LayoutResult } from '$lib/components/box_layout/types';
	import DeleteBoxDialog from '$lib/components/delete_box/DeleteBoxDialog.svelte';
	import {
		boxForRouteParam,
		listBoxConfigs,
		reconcileBoxConfig,
		saveBoxConfig,
		uniqueBoxName
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
	import { onDestroy, onMount, tick } from 'svelte';
	import {
		BufferGeometry,
		CanvasTexture,
		FrontSide,
		Group,
		LineBasicMaterial,
		LineLoop,
		LineSegments,
		Mesh,
		MeshBasicMaterial,
		MeshNormalMaterial,
		MeshPhysicalMaterial,
		PlaneGeometry,
		Quaternion,
		SRGBColorSpace,
		Vector3
	} from 'three';
	import {
		Download,
		Frame,
		SquareDashed,
		LayoutGrid,
		Sparkles,
		Copy,
		Play,
		Package,
		PackageOpen,
		X
	} from '@lucide/svelte';
	import { mergeProps } from 'svelte-toolbelt';
	import { Button } from 'bits-ui';
	import { getLightDarkContext } from '$lib/components/light_switch/light_dark_context';

	function mergeTriggerProps(parent: unknown, tip: Record<string, unknown>) {
		return mergeProps(parent as Record<string, unknown>, tip);
	}

	const boxId = page.params.boxId ?? '';

	let setData = $state<DiceSet | undefined>(undefined);
	let config = $state<BoxConfig | undefined>(undefined);
	// set once the user confirms delete, so a debounced save can't recreate the box.
	let removed = false;
	let alive = true;
	// Opaque Three.js handle — do NOT put this in $state. Deep-proxying the
	// renderer/camera/controls makes TrackballControls + the rAF loop fight the
	// reactive system and can leave the first frame blank.
	let ctx: SceneRenderer | undefined;
	let sceneReadyTick = $state(0);
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

	let fileLayout = $state<'single' | 'zip'>('single');
	let format = $state<ExportFormat>('3mf');

	const gridHelper = createGridHelper(160);

	// Default (non-fancy) look is three's normal material, matching the dice
	// export view's plain mode. The fancy materials below are only used when the
	// fancy toggle is on; the box and dice each get their own colour.
	const normalMat = new MeshNormalMaterial();
	// dice use a plain basic material in regular mode so their opacity can be
	// dialled down (the normal material ignores opacity).
	const dieBasicMat = new MeshBasicMaterial({
		color: getPreferences().boxDiceRenderColor,
		transparent: true,
		opacity: getPreferences().diceRenderOpacity
	});
	const dieFancyMat = new MeshPhysicalMaterial({
		color: getPreferences().boxDiceRenderColor,
		roughness: 1.0,
		metalness: 0.25,
		clearcoat: 0.81,
		clearcoatRoughness: 0.5,
		envMapIntensity: 0.9,
		transparent: true,
		opacity: getPreferences().diceRenderOpacity
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
	let fancyRender: ReturnType<typeof createFancyRender> | undefined;
	let fancy = $state(true);
	let wireframeOn = $state(false);
	let showBounds = $state(false);

	let ld = getLightDarkContext();
	let controlPresetClass = $derived(
		ld?.isLight ? 'preset-filled-surface-200-800' : 'preset-filled-surface-100-900'
	);

	$effect(() => {
		void sceneReadyTick;
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
		void sceneReadyTick;
		renderBounds();
	});
	// footprint size guides follow the built box and the light/dark background.
	$effect(() => {
		void built;
		void sceneReadyTick;
		renderSizeGuides(ld?.isLight ?? false);
	});
	// the FPS counter is always shown in developer mode.
	$effect(() => {
		void sceneReadyTick;
		ctx?.setStatsVisible(devMode);
	});

	// dice opacity is a user-facing control; apply it to both render modes. The
	// scene runs a continuous rAF loop, so the change is shown on the next frame
	// (don't call ctx.render() here - that starts a second, compounding loop).
	$effect(() => {
		for (const mat of [dieBasicMat, dieFancyMat]) {
			mat.opacity = prefs.diceRenderOpacity;
			// keep transparent always on; toggling it at runtime needs a shader
			// recompile and otherwise leaves the dice rendering opaque.
			mat.transparent = true;
		}
	});

	// tuning panel state; defaults mirror createFancyRender(). Colours live in
	// global preferences so the canvas controls and the dice export agree.
	let tune = $state({
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
		void sceneReadyTick;
		const fr = fancyRender;
		if (!fr || !ctx) {
			return;
		}
		fr.material.color.set(prefs.boxRenderColor);
		dieFancyMat.color.set(prefs.boxDiceRenderColor);
		dieBasicMat.color.set(prefs.boxDiceRenderColor);
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
		const boxes = listBoxConfigs();
		const found = boxForRouteParam(boxes, boxId);
		if (!found) {
			goto('/boxes');
			return;
		}
		// an old /boxes/<setId> link, when that set has a single box.
		if (found.id !== boxId) {
			await goto(`/boxes/${found.id}`, { replaceState: true });
		}
		if (!alive) {
			return;
		}
		setData = await waitForSet(found.setId);
		if (!alive) {
			return;
		}
		if (!setData) {
			goto('/boxes');
			return;
		}
		let next = reconcileBoxConfig(found, setData.dice);
		if (!next.name.trim()) {
			const taken = boxes.filter((b) => b.id !== next.id).map((b) => b.name);
			next = { ...next, name: uniqueBoxName(setData.name, taken) };
		}
		config = next;
		await tick();
		if (!alive) {
			return;
		}
		queueRebuild(false);
	});

	const sceneReady = (_ctx: SceneRenderer) => {
		ctx = _ctx;
		// top-down view: look straight down the box's height axis. up = -Z so the
		// footprint depth reads as screen vertical (lid above base).
		_ctx.camera.up.set(0, 0, -1);
		_ctx.camera.position.set(0, 180, 0);
		_ctx.controls.target.set(0, 0, 0);
		_ctx.camera.lookAt(0, 0, 0);
		_ctx.syncControls?.();
		fancyRender = createFancyRender(_ctx);
		fancyRender.setEnabled(fancy);
		_ctx.onBeforeRender(() => {
			stepLidAnim();
			faceSizeLabels();
		});
		// start the continuous rAF loop (otherwise the canvas stays blank).
		_ctx.render();
		sceneReadyTick++;
		queueRebuild(false);
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

	// Copy the current tuning values so they can be pasted back in to bless new
	// defaults: colours are preference fields, the rest is the `tune` initialiser.
	let copiedTuning = $state(false);
	async function copyTuning() {
		const lines = [
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
		const snippet = [
			`boxDiceRenderColor: '${prefs.boxDiceRenderColor}',`,
			`boxRenderColor: '${prefs.boxRenderColor}',`,
			`diceRenderOpacity: ${prefs.diceRenderOpacity},`,
			`let tune = $state({\n${lines.join('\n')}\n});`
		].join('\n');
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
	let buildError = $state<string | null>(null);
	async function rebuild() {
		if (!ctx || !setData || !config) {
			return;
		}
		const seq = ++buildSeq;
		buildProgress = null;
		buildFinished = false;
		atFinalFace = false;
		progressDecoupled = false;
		buildError = null;
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
			if (seq === buildSeq) {
				buildError = e instanceof Error ? e.message : String(e);
			}
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
	const persistName = debounce<void>(400, () => {
		if (removed || !config) {
			return;
		}
		try {
			saveBoxConfig($state.snapshot(config) as BoxConfig);
		} catch (e) {
			console.warn('failed to persist box name', e);
		}
	});
	onDestroy(() => {
		alive = false;
		clearInterval(previewTimer);
		clearSizeGuides();
		sizeGuideMat.dispose();
		if (!removed) {
			persistName.flush();
		}
	});
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
		clearSizeGuides();
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

	// Dimension lines for the body footprint only: width (X) and depth (Y) of the
	// seam octagon. Corner cuts don't change those two sizes. The hinge barrels
	// and the gap between the open halves are not included. Drawn on the base,
	// which stays put when the lid folds shut.
	let sizeGuideGroup: Group | undefined;
	const sizeGuideMat = new LineBasicMaterial({
		color: 0xe2e8f0,
		depthTest: false,
		depthWrite: false,
		toneMapped: false
	});

	function clearSizeGuides() {
		if (!sizeGuideGroup) {
			return;
		}
		sizeGuideGroup.traverse((o) => {
			const mesh = o as Mesh;
			if (mesh.userData.sizeLabel && mesh.material instanceof MeshBasicMaterial) {
				mesh.geometry?.dispose();
				mesh.material.map?.dispose();
				mesh.material.dispose();
				return;
			}
			if ((o as LineSegments).isLineSegments) {
				(o as LineSegments).geometry?.dispose();
			}
		});
		sizeGuideGroup.removeFromParent();
		sizeGuideGroup = undefined;
	}

	// Planes, not sprites. A sprite under the preview's -90° X rotation billboards
	// with its front face pointing down, so the top-down camera only sees the
	// blank back of the quad. These planes are turned to face the camera each
	// frame (see faceSizeLabels).
	function sizeLabel(text: string, height: number, light: boolean): Mesh {
		const fontPx = 128;
		const canvas = document.createElement('canvas');
		const draw = canvas.getContext('2d');
		const geo = new PlaneGeometry(1, 1);
		if (!draw) {
			return new Mesh(geo);
		}
		const font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
		draw.font = font;
		const padX = 18;
		const padY = 12;
		canvas.width = Math.ceil(draw.measureText(text).width + padX * 2);
		canvas.height = fontPx + padY * 2;
		draw.font = font;
		draw.textBaseline = 'middle';
		draw.lineJoin = 'round';
		draw.miterLimit = 2;
		draw.lineWidth = 12;
		draw.strokeStyle = light ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.8)';
		draw.fillStyle = light ? '#0f172a' : '#f8fafc';
		const ty = canvas.height / 2;
		draw.strokeText(text, padX, ty);
		draw.fillText(text, padX, ty);
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		const mat = new MeshBasicMaterial({
			map: texture,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
			side: FrontSide
		});
		const mesh = new Mesh(geo, mat);
		const aspect = canvas.width / canvas.height;
		mesh.scale.set(height * aspect, height, 1);
		mesh.renderOrder = 1000;
		mesh.userData.sizeLabel = true;
		return mesh;
	}

	const _labelParentQuat = new Quaternion();
	// World orientation = parent * local. Set local so the plane's +Z matches the
	// camera's +Z, which points back at the viewer — the numbered face leads.
	function faceSizeLabels() {
		if (!sizeGuideGroup || !ctx) {
			return;
		}
		// onBeforeRender runs before the renderer refreshes world matrices, so a
		// group added this frame would still report an identity orientation.
		sizeGuideGroup.updateWorldMatrix(true, false);
		sizeGuideGroup.traverse((o) => {
			const mesh = o as Mesh;
			if (!mesh.userData.sizeLabel || !mesh.parent) {
				return;
			}
			mesh.parent.getWorldQuaternion(_labelParentQuat);
			mesh.quaternion.copy(ctx.camera.quaternion).premultiply(_labelParentQuat.invert());
		});
	}

	function renderSizeGuides(light: boolean) {
		clearSizeGuides();
		if (!ctx || !built || !previewGroup) {
			return;
		}
		const hx = built.outer.x / 2;
		const hy = built.outer.y / 2;
		if (!(hx > 1) || !(hy > 1)) {
			return;
		}
		sizeGuideMat.color.set(light ? 0x0f172a : 0xe2e8f0);
		const offset = Math.max(5, Math.min(hx, hy) * 0.16);
		const tick = Math.min(2.4, Math.max(1.2, offset * 0.28));
		const arrow = tick * 1.5;
		const edgeGap = 1.6;
		const z = built.baseHeight + 0.5;
		const textH = Math.min(6.5, Math.max(3.2, Math.min(hx, hy) * 0.18));
		const yLine = -hy - offset;
		const xLine = -hx - offset;
		const pts: Array<Vector3> = [];
		const seg = (ax: number, ay: number, bx: number, by: number) => {
			pts.push(new Vector3(ax, ay, z), new Vector3(bx, by, z));
		};
		// arrow at the tip, opening back along (ix, iy) which points inward.
		const arrowHead = (tx: number, ty: number, ix: number, iy: number) => {
			const bx = tx + ix * arrow;
			const by = ty + iy * arrow;
			const px = -iy * arrow * 0.45;
			const py = ix * arrow * 0.45;
			seg(tx, ty, bx + px, by + py);
			seg(tx, ty, bx - px, by - py);
		};

		// width, along the opening side (front, -Y) — clear of the hinge.
		seg(-hx, yLine, hx, yLine);
		seg(-hx, yLine - tick, -hx, yLine + tick);
		seg(hx, yLine - tick, hx, yLine + tick);
		arrowHead(-hx, yLine, 1, 0);
		arrowHead(hx, yLine, -1, 0);
		seg(-hx, -hy - edgeGap, -hx, yLine - tick);
		seg(hx, -hy - edgeGap, hx, yLine - tick);

		// depth, along the left side (-X).
		seg(xLine, -hy, xLine, hy);
		seg(xLine - tick, -hy, xLine + tick, -hy);
		seg(xLine - tick, hy, xLine + tick, hy);
		arrowHead(xLine, -hy, 0, 1);
		arrowHead(xLine, hy, 0, -1);
		seg(-hx - edgeGap, -hy, xLine - tick, -hy);
		seg(-hx - edgeGap, hy, xLine - tick, hy);

		const lines = new LineSegments(new BufferGeometry().setFromPoints(pts), sizeGuideMat);
		lines.renderOrder = 998;
		const unit = m.boxes_unit_mm();
		const xLabel = sizeLabel(`${built.outer.x.toFixed(1)} ${unit}`, textH, light);
		xLabel.position.set(0, yLine - textH * 0.7, z);
		const yLabel = sizeLabel(`${built.outer.y.toFixed(1)} ${unit}`, textH, light);
		yLabel.position.set(xLine - yLabel.scale.x * 0.55 - textH * 0.25, 0, z);

		const g = new Group();
		const plateGap = built.hinge ? built.hinge.partingGap : 8;
		g.position.set(0, -(built.outer.y + plateGap) / 2, 0);
		g.add(lines, xLabel, yLabel);
		previewGroup.add(g);
		sizeGuideGroup = g;
	}

	const scheduleRebuild = debounce<void>(200, () => {
		void rebuild();
	});
	onDestroy(() => scheduleRebuild.cancel());

	function prepareToDeleteBox() {
		removed = true;
		persistName.cancel();
		scheduleRebuild.cancel();
	}

	/** Kick a build once scene + set + config are all present. */
	function queueRebuild(debounced: boolean) {
		if (removed || !ctx || !setData || !config) {
			return;
		}
		if (debounced) {
			scheduleRebuild();
		} else {
			scheduleRebuild.cancel();
			void rebuild();
		}
		// persist after scheduling so a snapshot failure can't block the build
		try {
			saveBoxConfig($state.snapshot(config) as BoxConfig);
		} catch (e) {
			console.warn('failed to persist box config', e);
		}
	}

	function setParam<K extends keyof BoxConfig['params']>(key: K, value: BoxConfig['params'][K]) {
		if (!config) {
			return;
		}
		if (config.params[key] === value) {
			return;
		}
		config.params[key] = value;
		queueRebuild(true);
	}

	function setMagnet<K extends keyof BoxConfig['params']['magnets']>(
		key: K,
		value: BoxConfig['params']['magnets'][K]
	) {
		if (!config) {
			return;
		}
		if (config.params.magnets[key] === value) {
			return;
		}
		config.params.magnets[key] = value;
		queueRebuild(true);
	}

	function setHinge(value: boolean) {
		if (!config) {
			return;
		}
		if (config.params.hinge.enabled === value) {
			return;
		}
		config.params.hinge.enabled = value;
		// a hinged box only needs magnets on the opening side; drop a 4-magnet
		// box to the opening pair when the hinge is switched on.
		if (value && config.params.magnets.count > 2) {
			config.params.magnets.count = 2;
		}
		queueRebuild(true);
	}

	function setHingeParam<K extends keyof BoxConfig['params']['hinge']>(
		key: K,
		value: BoxConfig['params']['hinge'][K]
	) {
		if (!config) {
			return;
		}
		if (config.params.hinge[key] === value) {
			return;
		}
		config.params.hinge[key] = value;
		queueRebuild(true);
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

	function dieLabel(kind: string, dieId: string): string {
		const die = setData?.dice.find((d) => d.id === dieId);
		return dieListLabel(
			(die?.kind ?? kind) as keyof typeof dice,
			die?.legend_ordering,
			die?.nickname
		);
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
		queueRebuild(false);
	}

	async function exportBox() {
		if (!built) {
			return;
		}
		const name = (config?.name || setData?.name || 'box').replace(/[^a-z0-9-_]+/gi, '_');
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
			const named: Array<NamedMesh> = [
				{ name: `${name}_box_base`, mesh: base, group: 'box' },
				{ name: `${name}_box_lid`, mesh: lid, group: 'box' }
			];
			if (format === '3mf') {
				// base + lid are one print-in-place piece: keep them as a single
				// grouped 3MF object so the slicer never treats them as two parts.
				download(
					await exportThreeMfGrouped([{ name: `${name}_box`, meshes: named }], 'z', threemfOpts),
					`${name}_box.3mf`
				);
			} else {
				download(exportStlSingle(named, 'z'), `${name}_box.stl`);
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
				download(exportStlZip(named, 'z'), `${name}_box.zip`);
			}
		} else {
			const base = new Mesh(built.base.clone(), normalMat);
			const lid = new Mesh(built.lid.clone(), normalMat);
			// place side by side so they don't overlap in one file (Z-up frame).
			lid.geometry.translate(built.outer.x + 8, 0, 0);
			const named: Array<NamedMesh> = [
				{ name: `${name}_box_base`, mesh: base, group: 'box' },
				{ name: `${name}_box_lid`, mesh: lid, group: 'box' }
			];
			if (format === '3mf') {
				// the base and lid are halves of one box: group them into a single
				// 3MF object rather than two independent build items.
				download(
					await exportThreeMfGrouped([{ name: `${name}_box`, meshes: named }], 'z', threemfOpts),
					`${name}_box.3mf`
				);
			} else {
				download(exportStlSingle(named, 'z'), `${name}_box.stl`);
			}
		}
	}
</script>

<div class="flex h-full flex-row gap-4 p-4">
	<Scene class="relative h-full grow" {sceneReady}>
		<ul class="absolute top-2 left-2 z-10 flex flex-col gap-2">
			<li class="card {controlPresetClass} flex w-56 flex-col gap-2 p-2 text-sm">
				<label class="flex items-center justify-between gap-2">
					<span>{m.boxes_tuning_die_colour()}</span>
					<input
						type="color"
						class="h-6 w-10 cursor-pointer rounded"
						aria-label={m.boxes_tuning_die_colour()}
						value={prefs.boxDiceRenderColor}
						oninput={(e) => setPreference('boxDiceRenderColor', e.currentTarget.value)}
					/>
				</label>
				<div class="flex flex-col gap-1">
					<span class="flex justify-between">
						<span>{m.boxes_tuning_die_opacity()}</span>
						<span>{Math.round(prefs.diceRenderOpacity * 100)}%</span>
					</span>
					<Slider
						class="py-1"
						value={prefs.diceRenderOpacity}
						min={0}
						max={1}
						step={0.01}
						onChange={(v) => setPreference('diceRenderOpacity', v)}
					/>
				</div>
			</li>
			<li class="card {controlPresetClass} flex w-56 flex-col gap-1 p-2 text-sm">
				<label class="flex items-center justify-between gap-2">
					<span>{m.boxes_tuning_box_colour()}</span>
					<input
						type="color"
						class="h-6 w-10 cursor-pointer rounded"
						aria-label={m.boxes_tuning_box_colour()}
						title={m.export_render_tuning_hint()}
						value={prefs.boxRenderColor}
						oninput={(e) => setPreference('boxRenderColor', e.currentTarget.value)}
					/>
				</label>
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
			<li>
				<div class="card {controlPresetClass} inline-flex gap-2 p-2">
					<Tooltip content={m.controls_toggle_fancy_render()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class={'btn-icon ' +
									(fancy ? 'preset-filled-secondary-500' : 'preset-filled-primary-500')}
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
				</div>
			</li>
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
		<div class="flex items-center justify-between gap-2">
			<a class="btn preset-tonal-surface" href="/boxes">{m.boxes_back_to_boxes()}</a>
			{#if config}
				{@const boxConfig = config}
				<Tooltip content={m.boxes_delete_button()} side="bottom">
					{#snippet children(tipProps)}
						<DeleteBoxDialog
							boxId={boxConfig.id}
							boxName={boxConfig.name || setData?.name || ''}
							beforeDelete={prepareToDeleteBox}
							onDeleted={() => goto('/boxes')}
						>
							{#snippet trigger(dialogProps)}
								{@const merged = mergeTriggerProps(dialogProps, tipProps)}
								<button
									{...merged}
									type="button"
									class="btn-icon preset-filled-error-500 shrink-0"
									aria-label={m.boxes_delete_button()}
								>
									<X class="size-4" />
								</button>
							{/snippet}
						</DeleteBoxDialog>
					{/snippet}
				</Tooltip>
			{/if}
		</div>
		{#if config}
			<label class="label">
				<span class="label-text">{m.boxes_name()}</span>
				<input class="input" type="text" bind:value={config.name} oninput={() => persistName()} />
			</label>
			{#if setData}
				<p class="text-surface-600-400 text-sm">{m.boxes_from_set({ name: setData.name })}</p>
			{/if}
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
			{#if buildError}
				<p class="text-error-500 text-xs" role="alert">{buildError}</p>
			{/if}
			<p class="text-surface-600-400 text-xs">{m.boxes_seam_hint()}</p>

			<Collapsible title={m.boxes_section_dimensions()}>
				<div class="flex flex-col gap-2 pt-2">
					{@render sliderRow(
						m.boxes_wall(),
						config.params.wall,
						BOX_PARAM_SLIDER_BOUNDS.wall,
						(v) => setParam('wall', v)
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
						{#if config.params.magnets.mode === 'printin'}
							{@render sliderRow(
								m.boxes_magnet_cover(),
								config.params.magnets.cover,
								BOX_PARAM_SLIDER_BOUNDS.magnets.cover,
								(v) => setMagnet('cover', v)
							)}
						{/if}
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
