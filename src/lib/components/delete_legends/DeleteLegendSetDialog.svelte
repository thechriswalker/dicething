<script lang="ts">
	import Modal from '$lib/components/modal/Modal.svelte';
	import { deleteLegendSet, setsUsingLegend } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		legendId,
		legendName,
		trigger,
		onDeleted
	}: {
		legendId: string;
		legendName: string;
		trigger: Snippet<[HTMLButtonAttributes]>;
		onDeleted?: () => void;
	} = $props();

	// dice sets that depend on this legend set; deletion is blocked while non-empty.
	let inUse = $derived(setsUsingLegend(legendId));

	async function confirmDelete(close: () => void) {
		await deleteLegendSet(legendId);
		close();
		onDeleted?.();
	}
</script>

{#snippet title()}
	{m.legends_delete_title()}
{/snippet}

{#snippet inner(close: () => void)}
	{#if inUse.length > 0}
		<p class="text-lg">
			{m.legends_delete_in_use({ name: legendName, count: inUse.length })}
		</p>
		<ul class="my-2 list-inside list-disc">
			{#each inUse as set (set.id)}
				<li>{set.name}</li>
			{/each}
		</ul>
		<div class="flex flex-row justify-end gap-2">
			<button type="button" class="btn preset-tonal-surface" onclick={close}>
				{m.legends_delete_cancel()}
			</button>
		</div>
	{:else}
		<p class="text-lg">{m.legends_delete_warning({ name: legendName })}</p>
		<div class="flex flex-row justify-end gap-2">
			<button type="button" class="btn preset-tonal-surface" onclick={close}>
				{m.legends_delete_cancel()}
			</button>
			<button
				type="button"
				class="btn preset-filled-error-500"
				onclick={() => confirmDelete(close)}
			>
				{m.legends_delete_confirm()}
			</button>
		</div>
	{/if}
{/snippet}

<Modal {title} {inner} {trigger} />
