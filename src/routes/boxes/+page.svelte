<script lang="ts">
	import { goto } from '$app/navigation';
	import Time from '$lib/components/time/Time.svelte';
	import DiePreview from '$lib/components/die_preview/DiePreview.svelte';
	import BoxLayoutPreview from '$lib/components/box_layout/BoxLayoutPreview.svelte';
	import DeleteBoxDialog from '$lib/components/delete_box/DeleteBoxDialog.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import { getSavedSets, waitForInitialLoad, type DiceSet } from '$lib/interfaces/storage.svelte';
	import {
		backfillBoxNames,
		defaultBoxConfig,
		listBoxConfigs,
		saveBoxConfig,
		uniqueBoxName
	} from '$lib/box/store';
	import type { BoxConfig } from '$lib/box/types';
	import { m } from '$lib/paraglide/messages';
	import { mergeProps } from 'svelte-toolbelt';
	import { Plus, X } from '@lucide/svelte';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import { onMount } from 'svelte';

	const savedSets = $derived(getSavedSets());

	// how many dice to show as a thumbnail strip on each set card.
	const PREVIEW_COUNT = 5;

	let boxes = $state<Array<BoxConfig>>([]);
	let ready = $state(false);
	// true once the user asks for a new box. With no saved boxes we skip straight
	// to picking a set.
	let pickingSet = $state(false);
	let creating = $state(false);

	function mergeTriggerProps(parent: unknown, tip: Record<string, unknown>) {
		return mergeProps(parent as Record<string, unknown>, tip);
	}

	let showSets = $derived(pickingSet || boxes.length === 0);

	onMount(async () => {
		await waitForInitialLoad();
		const sets = getSavedSets();
		boxes = backfillBoxNames(
			listBoxConfigs(),
			(id) => sets.find((s) => s.id === id)?.name,
			saveBoxConfig
		);
		ready = true;
	});

	function setFor(setId: string): DiceSet | undefined {
		return savedSets.find((s) => s.id === setId);
	}

	async function createFromSet(set: DiceSet) {
		if (creating) {
			return;
		}
		creating = true;
		try {
			const name = uniqueBoxName(
				set.name,
				boxes.map((b) => b.name)
			);
			const config = saveBoxConfig(defaultBoxConfig(set.id, set.dice, name));
			await goto('/boxes/' + config.id);
		} finally {
			creating = false;
		}
	}
</script>

<div class="flex min-h-full flex-col items-center justify-center p-4">
	<div class="card preset-filled-surface-100-900 w-full max-w-5xl p-4">
		{#if !ready}
			<Progress value={null} />
		{:else}
			<p class="card preset-filled-warning-500 mb-4 px-3 py-2" role="note">
				{m.boxes_wip_warning()}
			</p>
			{#if showSets}
				{#if pickingSet && boxes.length > 0}
					<button
						type="button"
						class="btn preset-tonal-surface mb-2 self-start"
						onclick={() => (pickingSet = false)}
					>
						{m.boxes_back_to_boxes()}
					</button>
				{/if}
				<h2 class="h2 my-4">{m.boxes_pick_set_header()}</h2>
				{#if savedSets.length > 0}
					<div class="my-2 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2">
						{#each savedSets as set (set.id)}
							{@const existing = boxes.filter((b) => b.setId === set.id).length}
							<button
								type="button"
								class="btn preset-tonal-primary flex flex-col justify-start gap-1 text-wrap"
								disabled={creating}
								onclick={() => createFromSet(set)}
							>
								<h6 class="text-xl">{set.name}</h6>
								<p><Time t={set.updated} /></p>
								{#if existing > 0}
									<p class="text-sm">{m.boxes_set_box_count({ count: existing })}</p>
								{/if}
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
							</button>
						{/each}
					</div>
				{:else}
					<p class="card preset-filled-warning-500 px-3 py-2">{m.boxes_no_sets()}</p>
				{/if}
			{:else}
				<div class="my-4 flex flex-wrap items-center justify-between gap-2">
					<h2 class="h2">{m.boxes_pick_box_header()}</h2>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={() => (pickingSet = true)}
					>
						<Plus class="size-4" />
						{m.boxes_new_box()}
					</button>
				</div>
				<div class="my-2 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2">
					{#each boxes as box (box.id)}
						{@const set = setFor(box.setId)}
						{@const included = box.placements.filter((p) => p.include).length}
						<div class="btn preset-tonal-primary relative flex flex-col justify-start text-wrap">
							{#if set}
								<a class="flex flex-col gap-2 p-1 pr-10 text-wrap" href={'/boxes/' + box.id}>
									<BoxLayoutPreview {set} config={box} />
									<div>
										<h6 class="text-xl">{box.name}</h6>
										<p class="text-sm">{set.name}</p>
										<p class="text-surface-600-400 text-sm">
											{m.boxes_included_count({ count: included })}
										</p>
										<p><Time t={box.updated} /></p>
									</div>
								</a>
							{:else}
								<div class="flex flex-col gap-2 p-1 pr-10 text-start">
									<div class="bg-surface-200-800 aspect-[4/3] w-full rounded-md"></div>
									<h6 class="text-xl">{box.name}</h6>
									<p class="text-sm">{m.boxes_missing_set()}</p>
									<p><Time t={box.updated} /></p>
								</div>
							{/if}
							<DeleteBoxDialog
								boxId={box.id}
								boxName={box.name}
								onDeleted={() => {
									boxes = boxes.filter((b) => b.id !== box.id);
								}}
							>
								{#snippet trigger(props)}
									<Tooltip content={m.boxes_delete_button()}>
										{#snippet children(tipProps)}
											{@const merged = mergeTriggerProps(props, tipProps)}
											<button
												{...merged}
												type="button"
												class="btn-icon absolute top-2 right-2 rounded-lg bg-red-500 text-white hover:bg-red-600"
												aria-label={m.boxes_delete_button()}
											>
												<X class="size-4" />
											</button>
										{/snippet}
									</Tooltip>
								{/snippet}
							</DeleteBoxDialog>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
