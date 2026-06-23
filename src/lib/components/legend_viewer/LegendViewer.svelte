<script lang="ts">
	import { Legend, type LegendSet } from '$lib/utils/legends';
	import type { Snippet } from 'svelte';
	import LegendPreview from './LegendPreview.svelte';

	type Props = {
		legends: LegendSet;
		selectedLegend?: Legend;
		onSelectedLegend?: (legend: Legend) => void;
		// optional content rendered after the glyphs (e.g. an "add legend" button).
		append?: Snippet;
	};

	let { legends, selectedLegend = -1, onSelectedLegend, append }: Props = $props();
</script>

{#snippet preview(l: Legend, selected: Legend)}
	<button
		onclick={() => {
			onSelectedLegend?.(l);
		}}
		type="button"
		class={'chip btn p-0  ' +
			(selected === l ? 'preset-tonal-primary' : 'preset-filled-primary-500')}
		title={legends.getLegendName(l)}
	>
		<LegendPreview legend={l} {legends} class="h-16" />
	</button>
{/snippet}

<div class="flex max-h-128 max-w-256 flex-row flex-wrap gap-4 overflow-y-auto p-4">
	{@render preview(Legend.BLANK, selectedLegend)}
	{#each legends as l}
		{@render preview(l, selectedLegend)}
	{/each}
	{@render append?.()}
</div>
