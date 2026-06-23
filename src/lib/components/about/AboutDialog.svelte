<script lang="ts">
	import { MessageCircleQuestion, XIcon } from '@lucide/svelte';
	import { Dialog, Portal, useDialog } from '@skeletonlabs/skeleton-svelte';
	import About from './About.svelte';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	const animation =
		'transition transition-discrete opacity-0 translate-y-[100px] starting:data-[state=open]:opacity-0 starting:data-[state=open]:translate-y-[100px] data-[state=open]:opacity-100 data-[state=open]:translate-y-0';

	let {
		open = $bindable(false),
		trigger
	}: {
		open?: boolean;
		trigger?: Snippet<[HTMLButtonAttributes]>;
	} = $props();

	let id = $props.id();
	let dialog = useDialog(() => ({
		id,
		open,
		onOpenChange: (e) => {
			open = e.open;
		}
	}));
</script>

<Dialog.Provider value={dialog}>
	{#if trigger}
		<Dialog.Trigger>
			{#snippet element(props)}
				{@render trigger(props)}
			{/snippet}
		</Dialog.Trigger>
	{/if}
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card preset-filled-surface-100-900 max-h-[85vh] w-full max-w-3xl space-y-4 overflow-hidden p-4 shadow-xl {animation}"
			>
				<header class="flex items-start justify-between gap-4">
					<Dialog.Title class="h1 flex items-center gap-4">
						<MessageCircleQuestion class="icon-text" />
						About
					</Dialog.Title>
					<Dialog.CloseTrigger class="btn-icon hover:preset-tonal shrink-0">
						<XIcon class="size-4" />
					</Dialog.CloseTrigger>
				</header>
				<Dialog.Description class="max-h-[calc(85vh-5rem)] overflow-y-auto">
					<About />
				</Dialog.Description>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog.Provider>
