<script lang="ts">
	import { Tooltip, type TooltipContentProps } from 'bits-ui';
	import type { Snippet } from 'svelte';
	interface Props {
		content: Snippet;
		children: Snippet;
		side?: TooltipContentProps['side'];
		sideOffset?: TooltipContentProps['sideOffset'];
		contentClasses?: string;
		contentPadding?: string;
	}
	let {
		content,
		children,
		side = 'top',
		sideOffset = 8,
		contentClasses = 'card preset-outlined bg-surface-950-50 text-surface-50-950 rounded-lg',
		contentPadding = 'px-2 py-1'
	}: Props = $props();
</script>

<Tooltip.Provider>
	<Tooltip.Root delayDuration={200}>
		<Tooltip.Trigger>
			{@render children()}
		</Tooltip.Trigger>
		<Tooltip.Content {side} {sideOffset}>
			<div class="{contentClasses} {contentPadding}">
				{@render content()}
			</div>
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
