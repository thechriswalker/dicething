<script lang="ts">
	import Modal from '$lib/components/modal/Modal.svelte';
	import { deleteSet } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		setId,
		setName,
		trigger,
		open = $bindable(false),
		onDeleted
	}: {
		setId: string;
		setName: string;
		trigger?: Snippet<[HTMLButtonAttributes]>;
		open?: boolean;
		onDeleted?: () => void;
	} = $props();

	function confirmDelete(close: () => void) {
		deleteSet(setId);
		close();
		onDeleted?.();
	}
</script>

{#snippet title()}
	{m.delete_set_title()}
{/snippet}

{#snippet inner(close: () => void)}
	<p class="text-lg">{m.delete_set_warning({ name: setName })}</p>
	<div class="flex flex-row justify-end gap-2">
		<button type="button" class="btn preset-tonal-surface" onclick={close}>
			{m.delete_set_cancel()}
		</button>
		<button type="button" class="btn preset-filled-error-500" onclick={() => confirmDelete(close)}>
			{m.delete_set_confirm()}
		</button>
	</div>
{/snippet}

<Modal bind:open {title} {inner} {trigger} />
