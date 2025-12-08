<script lang="ts">
	import { XIcon } from '@lucide/svelte';
	import { Dialog, Portal, useDialog } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	// The following animation is optional.
	// This may also be included inline.
	const animation =
		'transition transition-discrete opacity-0 translate-y-[100px] starting:data-[state=open]:opacity-0 starting:data-[state=open]:translate-y-[100px] data-[state=open]:opacity-100 data-[state=open]:translate-y-0';

	type Props = {
		trigger: Snippet<[HTMLButtonAttributes]>;
		title?: Snippet;
		inner: Snippet<[() => void]>;
	};

	let id = $props.id();
	let { inner, trigger, title }: Props = $props();

	let dialog = useDialog({ id });

	let close = () => {
		dialog().setOpen(false);
	};
</script>

<Dialog.Provider value={dialog}>
	<Dialog.Trigger>
		{#snippet element(props)}
			{@render trigger(props)}
		{/snippet}
	</Dialog.Trigger>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 space-y-4 p-4 shadow-xl {animation}">
				<header class="flex items-center justify-between">
					{#if title}<Dialog.Title class="text-lg font-bold">{@render title()}</Dialog.Title>{/if}
					<Dialog.CloseTrigger class="btn-icon hover:preset-tonal">
						<XIcon class="size-4" />
					</Dialog.CloseTrigger>
				</header>
				<Dialog.Description>
					{@render inner?.(close)}
				</Dialog.Description>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog.Provider>
