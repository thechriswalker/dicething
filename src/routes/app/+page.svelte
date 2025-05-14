<script lang="ts">
	import { goto } from '$app/navigation';
	import Time from '$lib/components/time/Time.svelte';
	import type { Preset } from '$lib/interfaces/presets';
	import { getSavedSets, saveSet, waitForInitialLoad } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { fromPreset, presets } from '$lib/presets';
	import { Progress } from '@skeletonlabs/skeleton-svelte';

	let savedSets = getSavedSets();

	async function handlePreset(fn: Preset) {
		const set = await fromPreset(fn);
		saveSet(set);
		goto('/d/' + set.id);
	}
</script>

<div class="flex min-h-full flex-col items-center justify-center">
	<div class="card preset-filled-surface-100-900 p-4">
		<h2 class="h2 my-4">{m['start.new_set_header']()}</h2>
		<div class="m-auto my-2 grid max-w-216 auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2">
			{#each Object.entries(presets) as [preset, fn]}
				<button
					class="btn preset-tonal-surface hover:preset-outlined-primary-500 block flex w-full flex-col justify-start gap-1 border-[1px] border-transparent text-wrap"
					onclick={() => handlePreset(fn)}
				>
					<h6 class="h4">
						{m['presets.title']({ preset })}
					</h6>
					<p class="">{m['presets.description']({ preset })}</p>
				</button>
			{/each}
		</div>
		<hr class="hr my-4" />
		<h2 class="h2 my-4 flex flex-row items-center justify-between">
			<span>{m['start.load_set_header']()}</span>
			<button
				class="btn btn-lg preset-tonal-secondary hidden font-normal sm:block"
				onclick={() => alert('not implemented yet :(')}>{m['start.import']()}</button
			>
		</h2>
		<button
			class="btn preset-tonal-secondary btn-lg my-4 block w-full sm:hidden"
			onclick={() => alert('not implemented yet :(')}>{m['start.import']()}</button
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
				<p class="card preset-filled-warning-500 px-3 py-2">{m['start.no_saved_sets']()}</p>
			{/if}
		{/await}
	</div>
</div>
