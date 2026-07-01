<script lang="ts">
	import { ArrowUpDown } from '@lucide/svelte';
	import { Collapsible } from '@skeletonlabs/skeleton-svelte';
	import { getContext } from 'svelte';
	import type { Snippet } from 'svelte';
	import { COLLAPSIBLE_GROUP_KEY, type CollapsibleGroupContext } from './CollapsibleGroup.svelte';

	let {
		title,
		titleExtra,
		children,
		defaultOpen = true,
		value
	}: {
		title: string;
		// optional content rendered next to the title (e.g. an info tooltip icon).
		titleExtra?: Snippet;
		children?: Snippet;
		defaultOpen?: boolean;
		value?: string;
	} = $props();

	const group = getContext<CollapsibleGroupContext | undefined>(COLLAPSIBLE_GROUP_KEY);
	const grouped = group !== undefined && value !== undefined;

	function onOpenChange(details: { open: boolean }) {
		if (!grouped) {
			return;
		}
		if (details.open) {
			group!.setOpen(value!);
		} else if (group!.collapsible) {
			group!.setOpen(null);
		}
	}
</script>

<Collapsible {...grouped ? { open: group!.open === value, onOpenChange } : { defaultOpen }}>
	<div class="preset-tonal flex w-full items-center justify-between rounded-sm p-1">
		<span class="flex items-center gap-1">
			<span class="font-bold">{title}</span>
			{@render titleExtra?.()}
		</span>
		<Collapsible.Trigger class="btn-icon hover:preset-tonal">
			<ArrowUpDown class="size-4" />
		</Collapsible.Trigger>
	</div>
	<Collapsible.Content class="w-full">
		{@render children?.()}
	</Collapsible.Content>
</Collapsible>
