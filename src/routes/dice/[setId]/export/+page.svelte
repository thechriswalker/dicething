<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Slider from '$lib/components/slider/Slider.svelte';
	import { waitForSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import { m } from '$lib/paraglide/messages';
	import { createFancyRender, createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { debounce } from '$lib/utils/debounce';
	import {
		buildExportMeshes,
		download,
		exportStlGroupZip,
		exportStlSingle,
		exportStlZip,
		exportThreeMfGrouped,
		exportThreeMfGroupZip,
		exportThreeMfZip,
		groupMeshesByCategory,
		layoutGrid,
		type ExportFormat,
		type OptionStates
	} from '$lib/utils/export';
	import { defaultValues, extraBuildOptions, isControlVisible } from '$lib/utils/build_options';
	import Collapsible from '$lib/components/collapsible/Collapsible.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import dice from '$lib/dice';
	import {
		approximateDieVolume,
		computeEngravingErrors,
		meshVolume,
		type EngravingError
	} from '$lib/utils/builder';
	import { checkMeshInWorker } from '$lib/utils/mesh_check_client';
	import { mergeMeshReports, type MeshCheckReport } from '$lib/utils/mesh_check';
	import { toNonIndexed } from '$lib/utils/3d';
	import { onMount } from 'svelte';
	import {
		BufferAttribute,
		BufferGeometry,
		DoubleSide,
		Group,
		Mesh,
		MeshBasicMaterial
	} from 'three';
	import { AlertTriangle, ArrowLeftIcon, DownloadIcon, Frame, SparklesIcon } from '@lucide/svelte';
	import { Button } from 'bits-ui';

	const setId = page.params.setId ?? '';

	let setData = $state<DiceSet | undefined>(undefined);
	let ctx = $state<SceneRenderer>();

	let selectedIds = $state<Array<string>>([]);
	// per-die engraving errors (faces whose legend won't engrave / would export
	// broken), keyed by die id. used to default-exclude broken dice and warn.
	let dieErrors = $state<Record<string, Array<EngravingError>>>({});
	let includeDice = $state(true);
	let format = $state<ExportFormat>('3mf');
	let fileLayout = $state<'single' | 'group' | 'object'>('single');

	let optionStates = $state<OptionStates>(
		Object.fromEntries(
			extraBuildOptions.map((o) => [
				o.id,
				{ enabled: !!o.defaultEnabled, values: defaultValues(o.controls) }
			])
		)
	);

	onMount(async () => {
		setData = await waitForSet(setId);
		if (!setData) {
			goto('/dice');
			return;
		}
		// flag dice whose engraving is broken so we can warn and leave them
		// unselected by default (the user can still opt in).
		const errs: Record<string, Array<EngravingError>> = {};
		for (const d of setData.dice) {
			const model = dice[d.kind];
			if (model) {
				errs[d.id] = computeEngravingErrors(model, setData.legends, d);
			}
		}
		dieErrors = errs;
		selectedIds = setData.dice.filter((d) => (errs[d.id]?.length ?? 0) === 0).map((d) => d.id);
	});

	let anyBrokenDice = $derived(Object.values(dieErrors).some((e) => e.length > 0));

	// per-die mesh-health report (manifold / watertight / degenerate), keyed by
	// die id, produced off the main thread by the mesh-check worker after each
	// preview rebuild. used to warn about dice that won't slice/print cleanly.
	let meshReports = $state<Record<string, MeshCheckReport>>({});
	let checkingMesh = $state(false);
	// bumped on every preview rebuild so stale async check results are ignored.
	let checkGeneration = 0;

	let anyMeshProblems = $derived(Object.values(meshReports).some((r) => !r.isPrintable));

	// true while an export is actively building/writing files, so the button can
	// disable itself and we don't fire overlapping exports.
	let exporting = $state(false);
	// the last export failure, surfaced in the UI. Export errors (e.g. Manifold
	// rejecting input, the 3MF writer failing) used to only reach the console, so
	// a user just saw nothing download. We catch and show them instead.
	let exportError = $state<string | undefined>(undefined);

	// dice whose mesh is open or non-manifold cannot be written as 3MF: that
	// format routes every object through Manifold (WASM), which rejects anything
	// that isn't a closed 2-manifold. STL has no such constraint, so we fall back
	// to it (and lock out 3MF) whenever any object would fail the manifold check.
	let anyNonManifold = $derived(
		Object.values(meshReports).some((r) => !r.isManifold || !r.isWatertight)
	);
	$effect(() => {
		if (anyNonManifold && format === '3mf') {
			format = 'stl';
		}
	});

	// whether to overlay the problem triangles (open/non-manifold/degenerate) in
	// red on the preview. on by default so issues are obvious; toggleable.
	let highlightProblems = $state(true);
	// positions (9 per triangle, in laid-out preview coords) of every problem
	// triangle from the latest check, kept so toggling can rebuild the overlay.
	let problemPositions: Float32Array | undefined;
	// the scene group holding the red problem-triangle overlay mesh.
	let problemGroup: Group | undefined;
	const _problemMaterial = new MeshBasicMaterial({ color: 0xff2222, side: DoubleSide });

	// human-readable list of a die's mesh problems (empty when printable).
	function meshIssues(report: MeshCheckReport | undefined): Array<string> {
		if (!report) {
			return [];
		}
		const issues: Array<string> = [];
		if (report.boundaryEdgeCount > 0) {
			issues.push(m.mesh_check_not_watertight({ count: report.boundaryEdgeCount }));
		}
		if (report.nonManifoldEdgeCount > 0) {
			issues.push(m.mesh_check_non_manifold({ count: report.nonManifoldEdgeCount }));
		}
		if (report.degenerateTriangleCount > 0) {
			issues.push(m.mesh_check_degenerate({ count: report.degenerateTriangleCount }));
		}
		if (report.duplicateTriangleCount > 0) {
			issues.push(m.mesh_check_duplicate({ count: report.duplicateTriangleCount }));
		}
		return issues;
	}

	// Check every freshly-built export mesh for manifold/watertight/degenerate
	// problems in the worker, aggregating per die. Results from superseded builds
	// (older generation) are dropped so rapid option changes don't race.
	async function runMeshChecks(named: Array<{ mesh: Mesh; dieId?: string }>) {
		const generation = ++checkGeneration;
		const byDie = new Map<string, Array<Mesh>>();
		for (const { mesh, dieId } of named) {
			if (!dieId) {
				continue;
			}
			let list = byDie.get(dieId);
			if (!list) {
				list = [];
				byDie.set(dieId, list);
			}
			list.push(mesh);
		}
		if (byDie.size === 0) {
			meshReports = {};
			return;
		}
		checkingMesh = true;
		try {
			const entries = await Promise.all(
				[...byDie].map(async ([dieId, meshes]) => {
					const reports = await Promise.all(
						meshes.map((mesh) =>
							// positions are read post-layout, so the returned problem
							// triangles are already in the preview's coordinate space.
							// expand any indexed geometry (e.g. a platform, which welds
							// its vertices) to a flat triangle soup first: checkMesh treats
							// the buffer as 9 floats per triangle and ignores the index.
							checkMeshInWorker(toNonIndexed(mesh.geometry).getAttribute('position').array, {
								collectBad: true
							})
						)
					);
					return [dieId, mergeMeshReports(reports)] as const;
				})
			);
			// a newer rebuild started while we were checking: discard these results.
			if (generation !== checkGeneration) {
				return;
			}
			meshReports = Object.fromEntries(entries);
			problemPositions = concatBadPositions(entries.map(([, r]) => r.badPositions));
			updateProblemHighlight();
		} catch (err) {
			console.warn('mesh check failed', err);
		} finally {
			if (generation === checkGeneration) {
				checkingMesh = false;
			}
		}
	}

	// flatten every die's problem-triangle buffer into one (or undefined when
	// there are none).
	function concatBadPositions(buffers: Array<Float32Array | undefined>): Float32Array | undefined {
		const present = buffers.filter((b): b is Float32Array => !!b && b.length > 0);
		if (present.length === 0) {
			return undefined;
		}
		const total = present.reduce((n, b) => n + b.length, 0);
		const out = new Float32Array(total);
		let off = 0;
		for (const b of present) {
			out.set(b, off);
			off += b.length;
		}
		return out;
	}

	// (re)build the red overlay mesh marking problem triangles, respecting the
	// highlight toggle. cheap to call repeatedly; disposes the previous overlay.
	function updateProblemHighlight() {
		if (problemGroup) {
			problemGroup.traverse((o) => {
				const mesh = o as Mesh;
				if (mesh.isMesh) {
					mesh.geometry?.dispose();
				}
			});
			ctx?.scene.remove(problemGroup);
			problemGroup = undefined;
		}
		if (!ctx || !highlightProblems || !problemPositions || problemPositions.length === 0) {
			// the continuous render loop will redraw without the overlay.
			return;
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(problemPositions.slice(), 3));
		geo.computeVertexNormals();
		const group = new Group();
		group.add(new Mesh(geo, _problemMaterial));
		ctx.scene.add(group);
		problemGroup = group;
	}

	function toggleHighlight() {
		highlightProblems = !highlightProblems;
		updateProblemHighlight();
	}

	const gridHelper = createGridHelper(80);

	let fancyRender = $state<ReturnType<typeof createFancyRender>>();
	let fancy = $state(true);
	let previewMeshes: Array<Mesh> = [];

	// the render tuning panel is exposed in developer mode.
	const prefs = getPreferences();
	let devMode = $derived(prefs.developerMode);
	let showTuning = $derived(prefs.developerMode);
	// developer-mode wireframe toggle for the export scene.
	let wireframeOn = $state(false);
	$effect(() => {
		if (!devMode && wireframeOn) {
			wireframeOn = false;
		}
		ctx?.setWireframe(wireframeOn);
	});

	// TEMP tuning panel state. Defaults mirror createFancyRender(). Once good
	// values are found these (and the panel markup) can be removed.
	let tune = $state({
		r: 0.42,
		g: 0.48,
		b: 0.58,
		roughness: 1.0,
		metalness: 0.25,
		clearcoat: 0.81,
		clearcoatRoughness: 0.5,
		envMapIntensity: 0.9,
		exposure: 1.0,
		lightIntensity: 2.2,
		lightIntensity2: 8,
		fillIntensity: 1.5,
		aoRadius: 2.5,
		aoScale: 1.0,
		aoThickness: 1.0,
		aoDistanceExponent: 1.0
	});

	// TEMP: push tuning values into the live render objects.
	$effect(() => {
		const fr = fancyRender;
		if (!fr || !ctx) {
			return;
		}
		fr.setColor(tune.r, tune.g, tune.b);
		fr.material.roughness = tune.roughness;
		fr.material.metalness = tune.metalness;
		fr.material.clearcoat = tune.clearcoat;
		fr.material.clearcoatRoughness = tune.clearcoatRoughness;
		fr.material.envMapIntensity = tune.envMapIntensity;
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

	const sceneReady = (_ctx: SceneRenderer) => {
		ctx = _ctx;
		_ctx.scene.add(gridHelper);
		_ctx.camera.position.set(0, 60, 90);
		_ctx.camera.lookAt(0, 0, 0);
		fancyRender = createFancyRender(_ctx);
		fancyRender.setEnabled(fancy);
		gridHelper.visible = !fancy;
		// start the render loop (otherwise the canvas stays blank).
		_ctx.render();
	};

	function toggleFancy() {
		fancy = !fancy;
		fancyRender?.setEnabled(fancy);
		gridHelper.visible = !fancy;
		previewMeshes.forEach((m) => fancyRender?.styleMesh(m));
	}

	let previewGroup: Group | undefined;
	function rebuildPreview() {
		if (!ctx || !setData) {
			return;
		}
		if (previewGroup) {
			ctx.scene.remove(previewGroup);
		}
		// drop any stale problem overlay; runMeshChecks will rebuild it for the new
		// layout once the (async) check finishes.
		problemPositions = undefined;
		updateProblemHighlight();
		const named = buildExportMeshes(setData, {
			selectedIds,
			includeDice,
			optionStates: $state.snapshot(optionStates)
		});
		// measure each build-option group's volume from its actual generated meshes
		// (the dice group is measured analytically, "without legends", elsewhere).
		const vols: Record<string, number> = {};
		for (const n of named) {
			if (n.group === 'dice') {
				continue;
			}
			vols[n.group] = (vols[n.group] ?? 0) + meshVolume(n.mesh) / 1000;
		}
		artifactVolumesMl = vols;
		const meshes = named.map((n) => n.mesh);
		layoutGrid(meshes);
		const group = new Group();
		meshes.forEach((mesh) => {
			fancyRender?.styleMesh(mesh);
			group.add(mesh);
		});
		ctx.scene.add(group);
		previewGroup = group;
		previewMeshes = meshes;
		// kick off the (worker-side) mesh-health check for the dice we just built.
		runMeshChecks(named);
	}
	const schedulePreview = debounce<void>(150, () => rebuildPreview());

	// signature of everything the preview depends on, so the effect re-runs when
	// any option/selection changes.
	let previewSig = $derived(
		JSON.stringify({ ids: selectedIds, dice: includeDice, opts: $state.snapshot(optionStates) })
	);
	$effect(() => {
		previewSig;
		if (ctx && setData) {
			schedulePreview();
		}
	});

	function dieLabel(kind: string, idx: number): string {
		return `${idx + 1}. ${m.dice_name({ kind })}`;
	}

	function toggleDie(id: string, checked: boolean) {
		if (checked) {
			if (!selectedIds.includes(id)) {
				selectedIds = [...selectedIds, id];
			}
		} else {
			selectedIds = selectedIds.filter((x) => x !== id);
		}
	}

	function selectAll() {
		selectedIds = setData?.dice.map((d) => d.id) ?? [];
	}
	function selectNone() {
		selectedIds = [];
	}

	function setOptionValue(optionId: string, controlId: string, value: number | boolean) {
		optionStates[optionId].values[controlId] = value;
	}

	let anyOptionEnabled = $derived(extraBuildOptions.some((o) => optionStates[o.id]?.enabled));
	let nothingToExport = $derived(selectedIds.length === 0 || (!includeDice && !anyOptionEnabled));

	// 1 ml = 1 cm³ = 1000 mm³ and the three.js unit is a mm.
	const volumeFormat = new Intl.NumberFormat(undefined, {
		maximumFractionDigits: 2,
		trailingZeroDisplay: 'stripIfInteger'
	});

	// approximate volume (ml) of the included dice, ignoring engraving. uses the
	// model's face geometry only (no engraving build), so it's cheap enough to
	// recompute instantly as the selection changes.
	let diceVolumeMl = $derived.by(() => {
		if (!setData || !includeDice) {
			return 0;
		}
		let mm3 = 0;
		for (const die of setData.dice) {
			if (!selectedIds.includes(die.id)) {
				continue;
			}
			const model = dice[die.kind];
			if (!model) {
				continue;
			}
			try {
				const faces = model.build(die.parameters, die.string_parameters ?? {}).faces;
				mm3 += approximateDieVolume(faces);
			} catch {
				// skip dice that fail to build; they can't be measured.
			}
		}
		return mm3 / 1000;
	});

	// per-build-option artifact volumes (ml), measured from the meshes that will
	// actually be exported. populated by rebuildPreview (which already builds them)
	// so we never build the artifact meshes twice. keyed by build-option id.
	let artifactVolumesMl = $state<Record<string, number>>({});

	// one row per non-empty export group (the dice, plus any enabled build option
	// that produced geometry), in registry order with dice first.
	let volumeGroups = $derived.by(() => {
		const rows: Array<{ id: string; label: string; volume: number }> = [];
		if (includeDice && diceVolumeMl > 0) {
			rows.push({ id: 'dice', label: m.export_include_dice(), volume: diceVolumeMl });
		}
		for (const option of extraBuildOptions) {
			const v = artifactVolumesMl[option.id];
			if (v && v > 0) {
				rows.push({ id: option.id, label: option.label(), volume: v });
			}
		}
		return rows;
	});
	let totalVolumeMl = $derived(volumeGroups.reduce((sum, row) => sum + row.volume, 0));

	// the "one file per group" layout only makes sense with more than one group
	// (dice + at least one artifact type). Fall back to a single file otherwise.
	let multiGroup = $derived(volumeGroups.length > 1);
	$effect(() => {
		if (fileLayout === 'group' && !multiGroup) {
			fileLayout = 'single';
		}
	});

	async function exportModel() {
		if (!setData || nothingToExport || exporting) {
			return;
		}
		exporting = true;
		exportError = undefined;
		try {
			const named = buildExportMeshes(setData, {
				selectedIds,
				includeDice,
				optionStates: $state.snapshot(optionStates)
			});
			const name = (setData.name || 'set').replace(/[^a-z0-9-_]+/gi, '_');
			const groups = groupMeshesByCategory(named, name);
			// dice are built Y-up; the 3MF writer reorients them to the print bed.
			// non-manifold objects can't be written as 3MF (Manifold rejects them), so
			// fall back to STL even if the format somehow still reads as 3mf here.
			if (format === '3mf' && !anyNonManifold) {
				if (fileLayout === 'object') {
					download(await exportThreeMfZip(named, 'y'), `${name}.zip`);
				} else if (fileLayout === 'group' && groups.length > 1) {
					// each group laid out within its own file, then one grouped 3MF per
					// group, all packed into a ZIP.
					for (const g of groups) {
						layoutGrid(g.meshes.map((n) => n.mesh));
					}
					download(await exportThreeMfGroupZip(groups, 'y'), `${name}.zip`);
				} else {
					layoutGrid(named.map((n) => n.mesh));
					// group each category (dice / blanks / platforms / ...) into one 3MF
					// object so the slicer treats each as a single grouped object.
					download(await exportThreeMfGrouped(groups, 'y'), `${name}.3mf`);
				}
				return;
			}
			if (fileLayout === 'object') {
				download(exportStlZip(named), `${name}.zip`);
			} else if (fileLayout === 'group' && groups.length > 1) {
				for (const g of groups) {
					layoutGrid(g.meshes.map((n) => n.mesh));
				}
				download(exportStlGroupZip(groups), `${name}.zip`);
			} else {
				const meshes = named.map((n) => n.mesh);
				layoutGrid(meshes);
				download(exportStlSingle(meshes), `${name}.stl`);
			}
		} catch (err) {
			// surface the failure instead of letting it vanish into the console: the
			// download silently never happened otherwise.
			console.error('export failed', err);
			const detail = err instanceof Error ? err.message : String(err);
			exportError = m.export_failed({ detail });
		} finally {
			exporting = false;
		}
	}
</script>

<Layout>
	{#snippet header()}
		<a class="btn preset-tonal-surface" href={'/dice/' + setId}>
			<ArrowLeftIcon class="size-4" />
		</a>
		<p class="text-primary-500 h4">{setData?.name}</p>
	{/snippet}

	<div class="flex h-full flex-row gap-4 p-4">
		<Scene class="relative h-full grow" {sceneReady}>
			<ul class="list-style-type-none absolute top-2 left-2 flex flex-col gap-2">
				<li>
					<Tooltip content={m.export_toggle_fancy_render()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class={'btn-icon ' + (fancy ? 'preset-filled-primary-500' : 'preset-tonal-primary')}
								aria-label={m.export_toggle_fancy_render()}
								aria-pressed={fancy}
								onclick={toggleFancy}><SparklesIcon /></Button.Root
							>
						{/snippet}
					</Tooltip>
				</li>
				{#if anyMeshProblems}
					<li>
						<Tooltip content={m.export_toggle_problem_highlight()} side="right">
							{#snippet children(props)}
								<Button.Root
									{...props}
									class={'btn-icon ' +
										(highlightProblems ? 'preset-filled-warning-500' : 'preset-tonal-warning')}
									aria-label={m.export_toggle_problem_highlight()}
									aria-pressed={highlightProblems}
									onclick={toggleHighlight}><AlertTriangle /></Button.Root
								>
							{/snippet}
						</Tooltip>
					</li>
				{/if}
				{#if devMode}
					<li>
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
					</li>
				{/if}
			</ul>
		</Scene>

		<div class="card preset-tonal-surface flex w-80 shrink-0 flex-col gap-3 overflow-y-auto p-4">
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
			{#if showTuning}
				<Collapsible defaultOpen={false} title={m.export_render_tuning_title()}>
					<div class="flex flex-col gap-2 pt-2">
						<p class="text-surface-600-400 text-xs">{m.export_render_tuning_hint()}</p>
						<span class="text-sm font-semibold">{m.export_render_tuning_base_colour()}</span>
						<div
							class="h-6 w-full rounded"
							style={`background: rgb(${Math.round(tune.r * 255)}, ${Math.round(tune.g * 255)}, ${Math.round(tune.b * 255)})`}
						></div>
						{@render tuneRow(m.export_render_tuning_r(), tune.r, 0, 1, 0.01, (v) => (tune.r = v))}
						{@render tuneRow(m.export_render_tuning_g(), tune.g, 0, 1, 0.01, (v) => (tune.g = v))}
						{@render tuneRow(m.export_render_tuning_b(), tune.b, 0, 1, 0.01, (v) => (tune.b = v))}
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

			<!-- dice selection -->
			<Collapsible title={m.export_select_dice()}>
				<div class="flex flex-col gap-2 pt-2">
					<div class="flex justify-end gap-2 text-xs">
						<button class="anchor" onclick={selectAll}>{m.export_select_all()}</button>
						<button class="anchor" onclick={selectNone}>{m.export_select_none()}</button>
					</div>
					<div class="flex flex-col gap-1">
						{#each setData?.dice ?? [] as die, idx}
							{@const errs = dieErrors[die.id] ?? []}
							{@const mIssues = meshIssues(meshReports[die.id])}
							<div class="flex items-center gap-2 text-sm">
								<label class="flex flex-1 items-center gap-2">
									<input
										type="checkbox"
										class="checkbox"
										checked={selectedIds.includes(die.id)}
										onchange={(e) => toggleDie(die.id, e.currentTarget.checked)}
									/>
									<span class={errs.length > 0 ? 'text-warning-600-400' : ''}>
										{dieLabel(die.kind, idx)}
									</span>
								</label>
								{#if errs.length > 0}
									<Tooltip side="left">
										{#snippet content()}
											<div class="flex flex-col gap-0.5">
												{#each errs as err}
													<span>{m.engraving_broken_for({ legend: err.legendName })}</span>
												{/each}
											</div>
										{/snippet}
										{#snippet children(props)}
											<span
												{...props}
												class="text-error-500 cursor-help"
												aria-label={m.engraving_errors_title()}
											>
												<AlertTriangle size={16} />
											</span>
										{/snippet}
									</Tooltip>
								{/if}
								{#if mIssues.length > 0}
									<Tooltip side="left">
										{#snippet content()}
											<div class="flex flex-col gap-0.5">
												{#each mIssues as issue}
													<span>{issue}</span>
												{/each}
											</div>
										{/snippet}
										{#snippet children(props)}
											<span
												{...props}
												class="text-warning-600-400 cursor-help"
												aria-label={m.mesh_check_title()}
											>
												<AlertTriangle size={16} />
											</span>
										{/snippet}
									</Tooltip>
								{/if}
							</div>
						{/each}
					</div>
					{#if anyBrokenDice}
						<p class="text-warning-600-400 text-xs">{m.engraving_excluded_hint()}</p>
					{/if}
					{#if anyMeshProblems}
						<p class="text-warning-600-400 text-xs">{m.mesh_check_hint()}</p>
					{/if}
				</div>
			</Collapsible>

			<!-- what to export -->
			<Collapsible title={m.export_what_to_export()}>
				<div class="flex flex-col gap-3 pt-2">
					<div class="border-surface-300-700 rounded-md border p-2">
						<label class="flex items-center justify-between gap-2">
							<span>{m.export_include_dice()}</span>
							<input
								type="checkbox"
								class="checkbox"
								checked={includeDice}
								onchange={(e) => (includeDice = e.currentTarget.checked)}
							/>
						</label>
						<p class="text-surface-600-400 text-xs">{m.export_include_dice_hint()}</p>
					</div>
					{#each extraBuildOptions as option}
						<div class="border-surface-300-700 rounded-md border p-2">
							<label class="flex items-center justify-between gap-2">
								<span>{option.label()}</span>
								<input
									type="checkbox"
									class="checkbox"
									checked={optionStates[option.id].enabled}
									onchange={(e) => (optionStates[option.id].enabled = e.currentTarget.checked)}
								/>
							</label>
							{#if option.description}
								<p class="text-surface-600-400 text-xs">{option.description()}</p>
							{/if}
							{#if optionStates[option.id].enabled}
								<div class="mt-2 flex flex-col gap-2">
									{#each option.controls as control}
										{#if isControlVisible(control, optionStates[option.id].values)}
											{#if control.kind === 'number'}
												<div class="flex flex-col">
													<span class="flex justify-between text-sm">
														<span>{control.label()}</span>
														<span>
															{optionStates[option.id].values[control.id]}{control.unit
																? ' ' + control.unit()
																: ''}
														</span>
													</span>
													<Slider
														class="py-1"
														value={Number(optionStates[option.id].values[control.id])}
														min={control.min}
														max={control.max}
														step={control.step}
														onChange={(v) => setOptionValue(option.id, control.id, v)}
													/>
													{#if control.help}
														<p class="text-surface-600-400 text-xs">{control.help()}</p>
													{/if}
												</div>
											{/if}
											{#if control.kind === 'bool'}
												<div class="flex flex-col">
													<label class="flex items-center justify-between gap-2 text-sm">
														<span>{control.label()}</span>
														<input
															type="checkbox"
															class="checkbox"
															checked={Boolean(optionStates[option.id].values[control.id])}
															onchange={(e) =>
																setOptionValue(option.id, control.id, e.currentTarget.checked)}
														/>
													</label>
													{#if control.help}
														<p class="text-surface-600-400 text-xs">{control.help()}</p>
													{/if}
												</div>
											{/if}
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</Collapsible>

			<!-- file layout -->
			<Collapsible title={m.export_file_layout()}>
				<div class="flex flex-col gap-2 pt-2">
					<label class="flex flex-col gap-1">
						<span class="text-sm">{m.export_format()}</span>
						<select class="select" bind:value={format}>
							<option value="stl">STL</option>
							<option value="3mf" disabled={anyNonManifold}>3MF</option>
						</select>
					</label>
					{#if anyNonManifold}
						<p class="text-warning-600-400 text-sm">{m.export_non_manifold_warning()}</p>
					{/if}
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" class="radio" value="single" bind:group={fileLayout} />
						<span>{m.export_file_single()}</span>
					</label>
					{#if multiGroup}
						<label class="flex items-center gap-2 text-sm">
							<input type="radio" class="radio" value="group" bind:group={fileLayout} />
							<span>{m.export_file_group()}</span>
						</label>
					{/if}
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" class="radio" value="object" bind:group={fileLayout} />
						<span>{m.export_file_object()}</span>
					</label>
				</div>
			</Collapsible>

			{#if volumeGroups.length > 0}
				<div class="border-surface-300-700 flex flex-col gap-0.5 rounded-md border p-2">
					<p class="text-sm font-semibold">{m.export_approx_volume()}</p>
					{#each volumeGroups as row (row.id)}
						<p class="flex justify-between text-sm">
							<span>{row.label}:</span>
							<span>{volumeFormat.format(row.volume)} ml</span>
						</p>
					{/each}
					{#if volumeGroups.length > 1}
						<p
							class="border-surface-300-700 mt-1 flex justify-between border-t pt-1 text-sm font-semibold"
						>
							<span>{m.export_volume_total()}:</span>
							<span>{volumeFormat.format(totalVolumeMl)} ml</span>
						</p>
					{/if}
					<p class="text-surface-600-400 mt-1 text-xs">{m.export_approx_volume_hint()}</p>
				</div>
			{/if}

			{#if nothingToExport}
				<p class="text-warning-600-400 text-sm">{m.export_nothing_selected()}</p>
			{/if}
			{#if exportError}
				<p class="text-error-600-400 text-sm" role="alert">{exportError}</p>
			{/if}
			<button
				class="btn preset-filled-primary-500"
				disabled={nothingToExport || exporting}
				onclick={exportModel}
			>
				<DownloadIcon class="size-4" />
				{exporting ? m.export_3d_button_working() : m.export_3d_button()}
			</button>
		</div>
	</div>
</Layout>
