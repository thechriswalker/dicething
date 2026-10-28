<script lang="ts">
	import Modal from '$lib/components/modal/Modal.svelte';
	import { deleteBoxConfig } from '$lib/box/store';
	import { m } from '$lib/paraglide/messages';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		boxId,
		boxName,
		trigger,
		open = $bindable(false),
		beforeDelete,
		onDeleted
	}: {
		boxId: string;
		boxName: string;
		trigger?: Snippet<[HTMLButtonAttributes]>;
		open?: boolean;
		beforeDelete?: () => void;
		onDeleted?: () => void;
	} = $props();

	function confirmDelete(close: () => void) {
		beforeDelete?.();
		deleteBoxConfig(boxId);
		close();
		onDeleted?.();
	}
</script>

{#snippet title()}
	{m.boxes_delete_title()}
{/snippet}

{#snippet inner(close: () => void)}
	<p class="text-lg">{m.boxes_delete_warning({ name: boxName })}</p>
	<div class="flex flex-row justify-end gap-2">
		<button type="button" class="btn preset-tonal-surface" onclick={close}>
			{m.boxes_delete_cancel()}
		</button>
		<button type="button" class="btn preset-filled-error-500" onclick={() => confirmDelete(close)}>
			{m.boxes_delete_confirm()}
		</button>
	</div>
{/snippet}

<Modal bind:open {title} {inner} {trigger} />
