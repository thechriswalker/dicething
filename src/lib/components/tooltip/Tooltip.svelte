<script lang="ts">
	import { Tooltip, type TooltipContentProps } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		// the tooltip body. either a plain string or a snippet for rich content.
		content: Snippet | string;
		// the trigger. the snippet receives the props that MUST be spread onto the
		// interactive element so it becomes the tooltip anchor. spreading onto the
		// caller's own element (instead of wrapping it) avoids the nested-<button>
		// problem and keeps the original element's semantics/styling.
		children: Snippet<[Record<string, unknown>]>;
		side?: TooltipContentProps['side'];
		sideOffset?: TooltipContentProps['sideOffset'];
		delayDuration?: number;
		// when true the tooltip never opens (e.g. no help text to show).
		disabled?: boolean;
		contentClasses?: string;
		contentPadding?: string;
	}

	let {
		content,
		children,
		side = 'top',
		sideOffset = 8,
		delayDuration = 200,
		disabled = false,
		contentClasses = 'card preset-outlined bg-surface-950-50 text-surface-50-950 max-w-xs rounded-lg text-sm shadow-lg',
		contentPadding = 'px-2 py-1'
	}: Props = $props();
</script>

<Tooltip.Provider>
	<Tooltip.Root {delayDuration}>
		<Tooltip.Trigger {disabled}>
			{#snippet child({ props })}
				{@render children(props)}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content {side} {sideOffset} class="z-[100]">
				<div class="{contentClasses} {contentPadding}">
					{#if typeof content === 'string'}
						{content}
					{:else}
						{@render content()}
					{/if}
				</div>
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
