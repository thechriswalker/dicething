<script lang="ts">
	import type { Legend, LegendSet } from '$lib/utils/legends';
	import { shapesToSVG } from '$lib/utils/shapes';

	let el: HTMLDivElement;

	let {
		legends,
		legend,
		class: classes = ''
	}: { class: string; legends: LegendSet; legend: Legend } = $props();

	$effect(() => {
		const svg = shapesToSVG(legends.get(legend));
		svg.setAttribute('viewBox', '-6 -6 12 12');
		svg.classList.add('fill-current', '-scale-y-100', 'w-full', 'h-full');
		el.replaceChildren(svg);
	});
</script>

<div bind:this={el} class={'aspect-1 ' + classes}></div>
