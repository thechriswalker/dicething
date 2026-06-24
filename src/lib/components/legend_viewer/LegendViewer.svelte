<script lang="ts">
	import { Legend, type LegendSet } from '$lib/utils/legends';
	import type { Snippet } from 'svelte';
	import LegendPreview from './LegendPreview.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';

	type Props = {
		legends: LegendSet;
		selectedLegend?: Legend;
		onSelectedLegend?: (legend: Legend) => void;
		// optional content rendered after the glyphs (e.g. an "add legend" button).
		append?: Snippet;
		// whether to show the (immutable) BLANK tile. It's a valid choice when
		// picking a face's legend, but can't be edited, so the editor hides it.
		showBlank?: boolean;
	};

	let {
		legends,
		selectedLegend = -1,
		onSelectedLegend,
		append,
		showBlank = true
	}: Props = $props();
</script>

{#snippet preview(l: Legend, selected: Legend)}
	<Tooltip content={legends.getLegendName(l)}>
		{#snippet children(props)}
			<button
				{...props}
				onclick={() => {
					onSelectedLegend?.(l);
				}}
				type="button"
				class={'chip btn p-0  ' +
					(selected === l ? 'preset-tonal-primary' : 'preset-filled-primary-500')}
				aria-label={legends.getLegendName(l)}
			>
				<LegendPreview legend={l} {legends} class="h-16" />
			</button>
		{/snippet}
	</Tooltip>
{/snippet}

<div class="flex max-h-128 max-w-256 flex-row flex-wrap gap-4 overflow-y-auto p-4">
	{#if showBlank}
		{@render preview(Legend.BLANK, selectedLegend)}
	{/if}
	{#each legends as l}
		{@render preview(l, selectedLegend)}
	{/each}
	{@render append?.()}
</div>
