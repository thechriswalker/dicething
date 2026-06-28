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
	import { buildBox, prepareLayout, type BuiltBox } from '$lib/box/box_builder';
	import LayoutEditor from '$lib/components/box_layout/LayoutEditor.svelte';
	import type { EditorItem, LayoutResult } from '$lib/components/box_layout/types';
	import {
		defaultBoxConfig,
		loadBoxConfig,
		reconcileBoxConfig,
		saveBoxConfig
	} from '$lib/box/store';
	import type { BoxConfig } from '$lib/box/types';
	import { download, exportStlSingle, exportStlZip, type NamedMesh } from '$lib/utils/export';
	import { onMount } from 'svelte';
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
		ArrowLeftIcon,
		DownloadIcon,
		Frame,
		BoxSelect,
		LayoutGridIcon,
		SparklesIcon,
		CopyIcon
	} from '@lucide/svelte';
	import { Button } from 'bits-ui';

	const setId = page.params.setId ?? '';

	let setData = $state<DiceSet | undefined>(undefined);
	let config = $state<BoxConfig | undefined>(undefined);
	let ctx = $state<SceneRenderer>();
	let building = $state(false);
	let outerSize = $state<{ x: number; y: number }>({ x: 0, y: 0 });

	// user-facing scene control: dice see-through-ness (0 = hidden, 1 = solid).
	let dieOpacity = $state(0.33);
	let fileLayout = $state<'single' | 'zip'>('zip');

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
		_ctx.scene.add(gridHelper);
		// top-down view: look straight down the box's height axis. up = -Z so the
		// footprint depth reads as screen vertical (lid above base).
		_ctx.camera.up.set(0, 0, -1);
		_ctx.camera.position.set(0, 180, 0);
		_ctx.camera.lookAt(0, 0, 0);
		fancyRender = createFancyRender(_ctx);
		fancyRender.setEnabled(fancy);
		gridHelper.visible = !fancy;
		_ctx.render();
	};

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
		building = true;
		try {
			const result = await buildBox(setData, $state.snapshot(config) as BoxConfig);
			built = result;
			outerSize = { x: result.outer.x, y: result.outer.y };
			renderPreview();
		} catch (e) {
			console.error('failed to build box', e);
		} finally {
			building = false;
		}
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
		const gap = 8;
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
			const g = new Group();
			g.position.set(0, offset, 0);
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
			root.add(g);
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
		const gap = 8;
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
			const prep = await prepareLayout(setData, $state.snapshot(config) as BoxConfig);
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
		config.params.rows = result.layoutParams.rows;
		config.params.gap = result.layoutParams.gap;
		config.params.marginX = result.layoutParams.marginX;
		config.params.marginY = result.layoutParams.marginY;
		config.params.chamfer = result.shape.chamfer;
		config.params.wall = result.shape.wall;
		config.params.magnets.enabled = result.shape.magnetsEnabled;
		config.params.magnets.count = result.shape.magnetCount;
		config.params.magnets.diameter = result.shape.magnetDiameter;
		config.params.magnets.tolerance = result.shape.magnetTolerance;
		layoutOpen = false;
	}

	function exportBox() {
		if (!built) {
			return;
		}
		const name = (setData?.name || 'set').replace(/[^a-z0-9-_]+/gi, '_');
		if (fileLayout === 'zip') {
			const named: Array<NamedMesh> = [
				{ name: `${name}_box_base`, mesh: new Mesh(built.base.clone(), normalMat), group: 'box' },
				{ name: `${name}_box_lid`, mesh: new Mesh(built.lid.clone(), normalMat), group: 'box' }
			];
			download(exportStlZip(named), `${name}_box.zip`);
		} else {
			const base = new Mesh(built.base.clone(), normalMat);
			const lid = new Mesh(built.lid.clone(), normalMat);
			// place side by side so they don't overlap in one file (Z-up frame).
			lid.geometry.translate(built.outer.x + 8, 0, 0);
			download(exportStlSingle([base, lid]), `${name}_box.stl`);
		}
	}
</script>

<Layout>
	{#snippet header()}
		<a class="btn preset-tonal-surface" href="/boxes" aria-label={m.boxes_back_to_sets()}>
			<ArrowLeftIcon class="size-4" />
		</a>
		<p class="text-primary-500 h4">{m.boxes_title()} — {setData?.name}</p>
	{/snippet}

	<div class="flex h-full flex-row gap-4 p-4">
		<Scene class="relative h-full grow" {sceneReady}>
			<ul class="absolute top-2 left-2 flex flex-col gap-2">
				<li class="card preset-filled-surface-100-900 flex w-56 flex-col gap-1 p-2 text-sm">
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
				<li class="card preset-filled-surface-100-900 flex gap-2 p-2">
					<Tooltip content={m.controls_toggle_fancy_render()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class={'btn-icon ' + (fancy ? 'preset-filled-primary-500' : 'preset-tonal-primary')}
								aria-label={m.controls_toggle_fancy_render()}
								aria-pressed={fancy}
								onclick={toggleFancy}><SparklesIcon /></Button.Root
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
									}}><BoxSelect /></Button.Root
								>
							{/snippet}
						</Tooltip>
					{/if}
				</li>
				{#if building}
					<li class="card preset-filled-surface-100-900 p-2 text-sm">{m.boxes_building()}</li>
				{/if}
			</ul>
		</Scene>

		<div class="card preset-tonal-surface flex w-80 shrink-0 flex-col gap-3 overflow-y-auto p-4">
			{#if config}
				{#snippet sliderRow(
					label: string,
					value: number,
					min: number,
					max: number,
					step: number,
					set: (v: number) => void,
					unit = m.boxes_unit_mm()
				)}
					<div class="flex flex-col">
						<span class="flex justify-between text-sm">
							<span>{label}</span>
							<span>{value}{unit ? ' ' + unit : ''}</span>
						</span>
						<Slider class="py-1" {value} {min} {max} {step} onChange={set} />
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
						{@render sliderRow(m.boxes_wall(), config.params.wall, 1, 6, 0.1, (v) =>
							setParam('wall', v)
						)}
						{@render sliderRow(m.boxes_floor(), config.params.floor, 0.6, 5, 0.1, (v) =>
							setParam('floor', v)
						)}
						{@render sliderRow(m.boxes_chamfer(), config.params.chamfer, 0, 30, 0.5, (v) =>
							setParam('chamfer', v)
						)}
						<p class="text-surface-600-400 text-xs">{m.boxes_chamfer_hint()}</p>
						{@render sliderRow(m.boxes_bevel(), config.params.bevel, 0, 8, 0.25, (v) =>
							setParam('bevel', v)
						)}
						<p class="text-surface-600-400 text-xs">{m.boxes_bevel_hint()}</p>
						{@render sliderRow(m.boxes_tray_depth(), config.params.trayDepth, 0, 6, 0.25, (v) =>
							setParam('trayDepth', v)
						)}
						<p class="text-surface-600-400 text-xs">{m.boxes_tray_depth_hint()}</p>
					</div>
				</Collapsible>

				<Collapsible title={m.boxes_section_cavities()}>
					<div class="flex flex-col gap-2 pt-2">
						{@render sliderRow(
							m.boxes_cavity_tolerance(),
							config.params.cavityTolerance,
							0,
							2,
							0.05,
							(v) => setParam('cavityTolerance', v)
						)}
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
									min={0}
									max={4}
									step={2}
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
								2,
								12,
								0.5,
								(v) => setMagnet('diameter', v)
							)}
							{@render sliderRow(
								m.boxes_magnet_thickness(),
								config.params.magnets.thickness,
								1,
								6,
								0.5,
								(v) => setMagnet('thickness', v)
							)}
							{@render sliderRow(
								m.boxes_magnet_tolerance(),
								config.params.magnets.tolerance,
								0,
								0.6,
								0.05,
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
							<LayoutGridIcon class="size-4" />
							<span>{layoutLoading ? m.boxes_layout_loading() : m.boxes_layout_edit()}</span>
						</button>
					</div>
				</Collapsible>

				<Collapsible title={m.boxes_section_export()}>
					<div class="flex flex-col gap-2 pt-2">
						<label class="flex items-center gap-2 text-sm">
							<input type="radio" class="radio" value="zip" bind:group={fileLayout} />
							<span>{m.boxes_export_zip()}</span>
						</label>
						<label class="flex items-center gap-2 text-sm">
							<input type="radio" class="radio" value="single" bind:group={fileLayout} />
							<span>{m.boxes_export_single()}</span>
						</label>
						{#if !anyIncluded}
							<p class="text-warning-600-400 text-sm">{m.boxes_nothing()}</p>
						{/if}
						<button
							class="btn preset-filled-primary-500"
							disabled={!built || building}
							onclick={exportBox}
						>
							<DownloadIcon class="size-4" />
							{m.boxes_export_button()}
						</button>
					</div>
				</Collapsible>

				{#if showTuning}
					<Collapsible defaultOpen={false} title={m.export_render_tuning_title()}>
						<div class="flex flex-col gap-2 pt-2">
							<p class="text-surface-600-400 text-xs">{m.export_render_tuning_hint()}</p>
							<button type="button" class="btn btn-sm preset-tonal-primary" onclick={copyTuning}>
								<CopyIcon class="size-4" />
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
</Layout>
