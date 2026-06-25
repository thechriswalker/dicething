<script lang="ts">
	import { ArrowUpDownIcon } from '@lucide/svelte';
	import { Collapsible } from '@skeletonlabs/skeleton-svelte';
	import { getContext } from 'svelte';
	import type { Snippet } from 'svelte';
	import { COLLAPSIBLE_GROUP_KEY, type CollapsibleGroupContext } from './CollapsibleGroup.svelte';

	let {
		title,
		children,
		defaultOpen = true,
		value
	}: {
		title: string;
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
		<p class="font-bold">{title}</p>
		<Collapsible.Trigger class="btn-icon hover:preset-tonal">
			<ArrowUpDownIcon class="size-4" />
		</Collapsible.Trigger>
	</div>
	<Collapsible.Content class="w-full">
		{@render children?.()}
	</Collapsible.Content>
</Collapsible>
