<script lang="ts">
	import { prepareLayoutInWorker } from '$lib/box/box_client';
	import { layoutFigure, type LayoutFigure } from '$lib/box/layout_figure';
	import type { BoxConfig } from '$lib/box/types';
	import type { DiceSet } from '$lib/interfaces/storage.svelte';
	import BoxLayoutSvg from './BoxLayoutSvg.svelte';

	let { set, config }: { set: DiceSet; config: BoxConfig } = $props();

	// The 2D layout (hulls + octagon), not the 3D box. Preparing each die's
	// footprint is enough; the picker never cuts the shell.
	let figure = $state<LayoutFigure | undefined>(undefined);
	let failed = $state(false);

	$effect(() => {
		const currentSet = set;
		const current = config;
		let cancelled = false;
		figure = undefined;
		failed = false;
		prepareLayoutInWorker(currentSet, current)
			.then((prep) => {
				if (!cancelled) {
					figure = layoutFigure(prep, current);
				}
			})
			.catch(() => {
				if (!cancelled) {
					failed = true;
				}
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="bg-surface-200-800 relative aspect-[4/3] w-full overflow-hidden rounded-md">
	{#if figure}
		<BoxLayoutSvg {figure} class="h-full w-full" />
	{:else if !failed}
		<div class="bg-surface-300-700/40 absolute inset-0 animate-pulse"></div>
	{/if}
</div>
