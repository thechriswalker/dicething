<script lang="ts">
	import { ArrowUpDownIcon } from '@lucide/svelte';
	import { Collapsible } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from 'svelte';

	let {
		title,
		children,
		defaultOpen = true
	}: { title: string; children?: Snippet; defaultOpen?: boolean } = $props();
</script>

<Collapsible {defaultOpen}>
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
