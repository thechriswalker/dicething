<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Slider from '$lib/components/slider/Slider.svelte';
	import { waitForSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { createFancyRender, createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { debounce } from '$lib/utils/debounce';
	import {
		buildExportMeshes,
		download,
		exportStlSingle,
		exportStlZip,
		layoutGrid,
		type ExportFormat,
		type OptionStates
	} from '$lib/utils/export';
	import { defaultValues, extraBuildOptions, isControlVisible } from '$lib/utils/build_options';
	import Collapsible from '$lib/components/collapsible/Collapsible.svelte';
	import { onMount } from 'svelte';
	import { Group, Mesh } from 'three';
	import { ArrowLeftIcon, DownloadIcon, SparklesIcon } from '@lucide/svelte';
	import { Button } from 'bits-ui';

	const setId = page.params.setId ?? '';

	let setData = $state<DiceSet | undefined>(undefined);
	let ctx = $state<SceneRenderer>();

	let selectedIds = $state<Array<string>>([]);
	let includeDice = $state(true);
	let format = $state<ExportFormat>('stl');
	let fileLayout = $state<'single' | 'zip'>('single');

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
			goto('/');
			return;
		}
		selectedIds = setData.dice.map((d) => d.id);
	});

	const gridHelper = createGridHelper(80);

	let fancyRender = $state<ReturnType<typeof createFancyRender>>();
	let fancy = $state(true);
	let previewMeshes: Array<Mesh> = [];

	// TEMP: hidden for now. Flip to true (or wire to a future debug/developer
	// mode) to expose the render tuning panel.
	let showTuning = $state(false);

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
		const named = buildExportMeshes(setData, {
			selectedIds,
			includeDice,
			optionStates: $state.snapshot(optionStates)
		});
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
	let nothingToExport = $derived(
		selectedIds.length === 0 || (!includeDice && !anyOptionEnabled)
	);

	function exportModel() {
		if (!setData || nothingToExport) {
			return;
		}
		const named = buildExportMeshes(setData, {
			selectedIds,
			includeDice,
			optionStates: $state.snapshot(optionStates)
		});
		const name = (setData.name || 'set').replace(/[^a-z0-9-_]+/gi, '_');
		if (fileLayout === 'single') {
			const meshes = named.map((n) => n.mesh);
			layoutGrid(meshes);
			download(exportStlSingle(meshes), `${name}.stl`);
		} else {
			download(exportStlZip(named), `${name}.zip`);
		}
	}
</script>

<Layout>
	{#snippet header()}
		<a class="btn preset-tonal-surface" href={'/d/' + setId}>
			<ArrowLeftIcon class="size-4" />
		</a>
		<p class="text-primary-500 h4">{setData?.name}</p>
	{/snippet}

	<div class="flex h-full flex-row gap-4 p-4">
		<Scene class="relative h-full grow" sceneReady={sceneReady}>
			<ul class="list-style-type-none absolute top-2 left-2 flex flex-col gap-2">
				<li>
					<Button.Root
						class={'btn-icon ' + (fancy ? 'preset-filled-primary-500' : 'preset-tonal-primary')}
						title={m.export_toggle_fancy_render()}
						aria-pressed={fancy}
						onclick={toggleFancy}><SparklesIcon /></Button.Root
					>
				</li>
			</ul>
		</Scene>

		<div
			class="card preset-tonal-surface flex w-80 shrink-0 flex-col gap-3 overflow-y-auto p-4"
		>
			<!-- TEMP render tuning panel: remove once good values are chosen -->
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
				<Collapsible title="Render tuning (temp)">
					<div class="flex flex-col gap-2 pt-2">
					<p class="text-surface-600-400 text-xs">Only affects the fancy render.</p>
					<span class="text-sm font-semibold">Base colour</span>
					<div
						class="h-6 w-full rounded"
						style={`background: rgb(${Math.round(tune.r * 255)}, ${Math.round(tune.g * 255)}, ${Math.round(tune.b * 255)})`}
					></div>
					{@render tuneRow('R', tune.r, 0, 1, 0.01, (v) => (tune.r = v))}
					{@render tuneRow('G', tune.g, 0, 1, 0.01, (v) => (tune.g = v))}
					{@render tuneRow('B', tune.b, 0, 1, 0.01, (v) => (tune.b = v))}
					<span class="text-sm font-semibold">Material</span>
					{@render tuneRow('Roughness', tune.roughness, 0, 1, 0.01, (v) => (tune.roughness = v))}
					{@render tuneRow('Metalness', tune.metalness, 0, 1, 0.01, (v) => (tune.metalness = v))}
					{@render tuneRow('Clearcoat', tune.clearcoat, 0, 1, 0.01, (v) => (tune.clearcoat = v))}
					{@render tuneRow(
						'Clearcoat rough',
						tune.clearcoatRoughness,
						0,
						1,
						0.01,
						(v) => (tune.clearcoatRoughness = v)
					)}
					{@render tuneRow(
						'Env intensity',
						tune.envMapIntensity,
						0,
						3,
						0.05,
						(v) => (tune.envMapIntensity = v)
					)}
					{@render tuneRow('Exposure', tune.exposure, 0, 3, 0.05, (v) => (tune.exposure = v))}
					<span class="text-sm font-semibold">Lighting</span>
					{@render tuneRow(
						'Key light',
						tune.lightIntensity,
						0,
						12,
						0.1,
						(v) => (tune.lightIntensity = v)
					)}
					{@render tuneRow(
						'Key light 2',
						tune.lightIntensity2,
						0,
						12,
						0.1,
						(v) => (tune.lightIntensity2 = v)
					)}
					{@render tuneRow(
						'Fill (hemi)',
						tune.fillIntensity,
						0,
						5,
						0.05,
						(v) => (tune.fillIntensity = v)
					)}
					<span class="text-sm font-semibold">Ambient occlusion</span>
					{@render tuneRow('AO radius', tune.aoRadius, 0, 10, 0.1, (v) => (tune.aoRadius = v))}
					{@render tuneRow('AO scale', tune.aoScale, 0, 3, 0.05, (v) => (tune.aoScale = v))}
					{@render tuneRow('AO thickness', tune.aoThickness, 0, 3, 0.05, (v) => (tune.aoThickness = v))}
					{@render tuneRow(
						'AO dist exp',
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
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="checkbox"
									checked={selectedIds.includes(die.id)}
									onchange={(e) => toggleDie(die.id, e.currentTarget.checked)}
								/>
								<span>{dieLabel(die.kind, idx)}</span>
							</label>
						{/each}
					</div>
				</div>
			</Collapsible>

			<!-- what to export -->
			<Collapsible title={m.export_what_to_export()}>
				<div class="flex flex-col gap-3 pt-2">
					<div class="rounded-md border border-surface-300-700 p-2">
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
						<div class="rounded-md border border-surface-300-700 p-2">
							<label class="flex items-center justify-between gap-2">
								<span>{option.label}</span>
								<input
									type="checkbox"
									class="checkbox"
									checked={optionStates[option.id].enabled}
									onchange={(e) => (optionStates[option.id].enabled = e.currentTarget.checked)}
								/>
							</label>
							{#if option.description}
								<p class="text-surface-600-400 text-xs">{option.description}</p>
							{/if}
							{#if optionStates[option.id].enabled}
								<div class="mt-2 flex flex-col gap-2">
									{#each option.controls as control}
										{#if isControlVisible(control, optionStates[option.id].values)}
											{#if control.kind === 'number'}
												<div class="flex flex-col">
													<span class="flex justify-between text-sm">
														<span>{control.label}</span>
														<span>
															{optionStates[option.id].values[control.id]}{control.unit
																? ' ' + control.unit
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
														<p class="text-surface-600-400 text-xs">{control.help}</p>
													{/if}
												</div>
											{/if}
											{#if control.kind === 'bool'}
												<div class="flex flex-col">
													<label class="flex items-center justify-between gap-2 text-sm">
														<span>{control.label}</span>
														<input
															type="checkbox"
															class="checkbox"
															checked={Boolean(optionStates[option.id].values[control.id])}
															onchange={(e) =>
																setOptionValue(option.id, control.id, e.currentTarget.checked)}
														/>
													</label>
													{#if control.help}
														<p class="text-surface-600-400 text-xs">{control.help}</p>
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
							<option value="3mf" disabled>3MF {m.export_format_3mf_soon()}</option>
						</select>
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" class="radio" value="single" bind:group={fileLayout} />
						<span>{m.export_file_single()}</span>
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" class="radio" value="zip" bind:group={fileLayout} />
						<span>{m.export_file_zip()}</span>
					</label>
				</div>
			</Collapsible>

			{#if nothingToExport}
				<p class="text-warning-600-400 text-sm">{m.export_nothing_selected()}</p>
			{/if}
			<button
				class="btn preset-filled-primary-500"
				disabled={nothingToExport}
				onclick={exportModel}
			>
				<DownloadIcon class="size-4" />
				{m.export_3d_button()}
			</button>
		</div>
	</div>
</Layout>
