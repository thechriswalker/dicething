<script lang="ts">
	import Layout from '$lib/components/layout/Layout.svelte';
	import Time from '$lib/components/time/Time.svelte';
	import DiePreview from '$lib/components/die_preview/DiePreview.svelte';
	import { getSavedSets, waitForInitialLoad } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Progress } from '@skeletonlabs/skeleton-svelte';

	const savedSets = $derived(getSavedSets());

	// how many dice to show as a thumbnail strip on each set card.
	const PREVIEW_COUNT = 5;
</script>

<Layout>
	<div class="flex min-h-full flex-col items-center justify-center">
		<div class="card preset-filled-surface-100-900 p-4">
			<h2 class="h2 my-4">{m.boxes_pick_set_header()}</h2>
			{#await waitForInitialLoad()}
				<Progress value={null} />
			{:then}
				{#if savedSets.length > 0}
					<div class="my-2 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2">
						{#each savedSets as set (set.id)}
							<a
								class="btn preset-tonal-primary flex flex-col justify-start gap-1 text-wrap"
								href={'/boxes/' + set.id}
							>
								<h6 class="text-xl">{set.name}</h6>
								<p><Time t={set.updated} /></p>
								{#if set.dice.length > 0}
									<div class="flex flex-row flex-wrap items-end gap-1">
										{#each set.dice.slice(0, PREVIEW_COUNT) as die (die.id)}
											<DiePreview class="w-12" {die} legends={set.legends} />
										{/each}
										{#if set.dice.length > PREVIEW_COUNT}
											<span class="text-surface-600-400 self-center text-sm"
												>+{set.dice.length - PREVIEW_COUNT}</span
											>
										{/if}
									</div>
								{/if}
							</a>
						{/each}
					</div>
				{:else}
					<p class="card preset-filled-warning-500 px-3 py-2">{m.boxes_no_sets()}</p>
				{/if}
			{/await}
		</div>
	</div>
</Layout>
