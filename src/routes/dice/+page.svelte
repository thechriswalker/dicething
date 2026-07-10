<script lang="ts">
	import { goto } from '$app/navigation';
	import DeleteSetDialog from '$lib/components/delete_set/DeleteSetDialog.svelte';
	import DiePreview from '$lib/components/die_preview/DiePreview.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import PresetOptions from '$lib/components/preset_options/PresetOptions.svelte';
	import Time from '$lib/components/time/Time.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import { mergeProps } from 'svelte-toolbelt';
	import type { Preset, PresetOption } from '$lib/interfaces/presets';
	import {
		getSavedSets,
		saveSet,
		waitForInitialLoad,
		type Dice
	} from '$lib/interfaces/storage.svelte';
	import type { LegendSet } from '$lib/utils/legends';
	import { m } from '$lib/paraglide/messages';
	import { fromPreset, presets } from '$lib/presets';
	import { importSetJson } from '$lib/utils/export';
	import { X } from '@lucide/svelte';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import { onMount } from 'svelte';

	// merge a parent trigger's props (e.g. a dialog trigger) with our tooltip
	// trigger props so a single element can drive both behaviours.
	function mergeTriggerProps(parent: unknown, tip: Record<string, unknown>) {
		return mergeProps(parent as Record<string, unknown>, tip);
	}

	const savedSets = $derived(getSavedSets());

	// how many dice to show as a thumbnail strip on each set / preset card.
	// 9 means row of 5, row of 4, + extra number
	const PREVIEW_COUNT = 9;

	// thumbnail dice for each preset, built once with the preset's default
	// options so the picker shows what each preset will produce. Built lazily on
	// mount (the factories are async and resolve legends), keyed by preset id.
	type PresetPreview = { dice: Array<Dice>; legends: LegendSet; total: number };
	let presetPreviews = $state<Record<string, PresetPreview>>({});

	onMount(async () => {
		for (const preset of presets) {
			try {
				const built = await preset.factory(preset.options());
				presetPreviews[preset.id] = {
					legends: built.legends,
					total: built.dice.length,
					dice: built.dice.slice(0, PREVIEW_COUNT).map((d, i) => ({
						...d,
						id: `preset:${preset.id}:${i}`
					}))
				};
			} catch (e) {
				console.warn('failed to build preset preview', preset.id, e);
			}
		}
	});

	let fileInput = $state<HTMLInputElement>();
	let importing = $state(false);

	function handlePreset(fn: Preset) {
		// options
		return async (opts: PresetOption[]) => {
			const set = await fn.factory(opts);
		};
	}

	async function onImportFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// reset so picking the same file again still fires a change event.
		input.value = '';
		if (!file) {
			return;
		}
		importing = true;
		try {
			const text = await file.text();
			const set = await importSetJson(text);
			saveSet(set);
			await goto('/dice/' + set.id);
		} catch (e) {
			alert(m.start_import_error({ error: e instanceof Error ? e.message : String(e) }));
		} finally {
			importing = false;
		}
	}
</script>

<Layout>
	<div class="flex min-h-full flex-col items-center justify-center">
		<div class="card preset-filled-surface-100-900 p-4">
			<h2 class="h2 my-4">{m.start_new_set_header()}</h2>
			<div
				class="m-auto my-2 grid max-w-[90vw] min-w-[60vh] auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
			>
				{#each presets as preset}
					{@const presetOptions = preset.options()}
					<Modal>
						{#snippet title()}
							<p class="h3">
								{m.presets_title({ preset: preset.id })}
							</p>
						{/snippet}
						{#snippet trigger(props)}
							<button
								{...props}
								class="btn preset-tonal-surface hover:preset-outlined-primary-500 block flex w-full flex-col justify-between gap-1 border-[1px] border-transparent text-wrap"
								><div>
									<h6 class="h4">
										{m.presets_title({ preset: preset.id })}
									</h6>
									<p class="">{m.presets_description({ preset: preset.id })}</p>
								</div>
								<div class="mx-auto mt-1 flex flex-row flex-wrap items-center justify-center gap-1">
									{#if presetPreviews[preset.id]?.dice.length}
										{@const pv = presetPreviews[preset.id]}
										{#each pv.dice as die (die.id)}
											<DiePreview class="size-12" {die} legends={pv.legends} />
										{/each}
										{#if pv.total > PREVIEW_COUNT}
											<span class="text-surface-600-400 w-12 self-center text-sm"
												>+{pv.total - PREVIEW_COUNT}</span
											>
										{/if}
									{/if}
								</div>
							</button>
						{/snippet}
						{#snippet inner(close)}
							<PresetOptions
								description={m.presets_description({ preset: preset.id })}
								name={m.presets_title({ preset: preset.id })}
								options={presetOptions}
								onSubmit={async (name, opts) => {
									// create the thing?
									const set = await fromPreset(preset, name, opts);
									saveSet(set);
									close();
									goto('/dice/' + set.id);
								}}
							/>
						{/snippet}
					</Modal>
				{/each}
			</div>
			<hr class="hr my-4" />
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json,.json"
				class="hidden"
				onchange={onImportFile}
			/>
			<h2 class="h2 my-4 flex flex-row items-center justify-between">
				<span>{m.start_load_set_header()}</span>
				<button
					class="btn btn-lg preset-tonal-secondary hidden font-normal sm:block"
					disabled={importing}
					onclick={() => fileInput?.click()}>{m.start_import()}</button
				>
			</h2>
			<button
				class="btn preset-tonal-secondary btn-lg my-4 block w-full sm:hidden"
				disabled={importing}
				onclick={() => fileInput?.click()}>{m.start_import()}</button
			>
			{#await waitForInitialLoad()}
				<Progress value={null} />
			{:then}
				{#if savedSets.length > 0}
					<div class="my-2 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{#each savedSets as set (set.id)}
							<div
								class="btn preset-tonal-primary relative flex flex-col justify-between gap-1 text-wrap"
							>
								<a
									class="flex flex-col justify-start gap-1 pr-8 text-center text-wrap"
									href={'/dice/' + set.id}
								>
									<div>
										<h6 class="text-xl">{set.name}</h6>
										<p><Time t={set.updated} /></p>
									</div>
									<div class="flex flex-row flex-wrap items-center justify-center gap-1">
										{#if set.dice.length > 0}
											{#each set.dice.slice(0, PREVIEW_COUNT) as die (die.id)}
												<DiePreview class="size-12" {die} legends={set.legends} />
											{/each}
											{#if set.dice.length > PREVIEW_COUNT}
												<span class="text-surface-600-400 w-12 self-center text-sm"
													>+{set.dice.length - PREVIEW_COUNT}</span
												>
											{/if}
										{/if}
									</div>
								</a>
								<DeleteSetDialog setId={set.id} setName={set.name}>
									{#snippet trigger(props)}
										<Tooltip content={m.delete_set_button()}>
											{#snippet children(tipProps)}
												{@const merged = mergeTriggerProps(props, tipProps)}
												<button
													{...merged}
													type="button"
													class="btn-icon absolute top-2 right-2 rounded-lg bg-red-500 text-white hover:bg-red-600"
													aria-label={m.delete_set_button()}
												>
													<X class="size-4" />
												</button>
											{/snippet}
										</Tooltip>
									{/snippet}
								</DeleteSetDialog>
							</div>
						{/each}
					</div>
				{:else}
					<p class="card preset-filled-warning-500 px-3 py-2">{m.start_no_saved_sets()}</p>
				{/if}
			{/await}
		</div>
	</div>
</Layout>
