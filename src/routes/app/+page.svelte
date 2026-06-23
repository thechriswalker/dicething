<script lang="ts">
	import { goto } from '$app/navigation';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import PresetOptions from '$lib/components/preset_options/PresetOptions.svelte';
	import Time from '$lib/components/time/Time.svelte';
	import type { Preset, PresetOption } from '$lib/interfaces/presets';
	import { getSavedSets, saveSet, waitForInitialLoad } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { fromPreset, presets } from '$lib/presets';
	import { importSetJson } from '$lib/utils/export';
	import { Progress } from '@skeletonlabs/skeleton-svelte';

	let savedSets = getSavedSets();

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
			await goto('/d/' + set.id);
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
			<div class="m-auto my-2 grid max-w-216 auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2">
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
								class="btn preset-tonal-surface hover:preset-outlined-primary-500 block flex w-full flex-col justify-start gap-1 border-[1px] border-transparent text-wrap"
							>
								<h6 class="h4">
									{m.presets_title({ preset: preset.id })}
								</h6>
								<p class="">{m.presets_description({ preset: preset.id })}</p>
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
									goto('/d/' + set.id);
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
					<div class="my-2 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2">
						{#each savedSets as set}
							<a
								class="btn preset-tonal-primary flex flex-col justify-start gap-1 text-wrap"
								href={'/d/' + set.id}
							>
								<h6 class="text-xl">{set.name}</h6>
								<p><Time t={set.updated} /></p>
							</a>
						{/each}
					</div>
				{:else}
					<p class="card preset-filled-warning-500 px-3 py-2">{m.start_no_saved_sets()}</p>
				{/if}
			{/await}
		</div>
	</div>
</Layout>
