<script module lang="ts">
	import { browser } from '$app/environment';
	import PreviewWorker from '$lib/utils/die-previewer.worker?worker';
	import { readCustomLegendSerialised } from '$lib/utils/legend_storage';
	import { serialiseLegendSetForWorker } from '$lib/utils/preview_legends';

	let previewWorker: Worker;
	if (browser) {
		previewWorker = new PreviewWorker({ name: 'preview-worker' });
		previewWorker.addEventListener('message', (e) => {
			if (e.data?.msg === 'need-legends') {
				const serialised = readCustomLegendSerialised(e.data.id);
				if (serialised) {
					previewWorker.postMessage({ msg: 'legends', id: e.data.id, legends: serialised });
				}
			}
		});
	}
</script>

<script lang="ts">
	import { dieToJSON, type Dice } from '$lib/interfaces/storage.svelte';
	import type { LegendSet } from '$lib/utils/legends';

	const {
		die,
		legends,
		class: classes = ''
	}: { die: Dice; legends: LegendSet; class?: string } = $props();

	let imageURL = $state('');

	$effect(() => {
		const payload = {
			msg: 'die-preview' as const,
			die: dieToJSON(die),
			legendSetId: legends.id,
			legendUpdated: 'updated' in legends ? legends.updated : undefined,
			legends: serialiseLegendSetForWorker(legends)
		};
		const handleMessage = (e: MessageEvent) => {
			if (e.data.id === die.id) {
				if (imageURL) {
					URL.revokeObjectURL(imageURL);
				}
				imageURL = e.data.url;
			}
		};
		previewWorker.addEventListener('message', handleMessage);
		const schedule =
			typeof requestIdleCallback !== 'undefined'
				? (cb: () => void) => requestIdleCallback(cb, { timeout: 2000 })
				: (cb: () => void) => window.setTimeout(cb, 0);
		const cancel =
			typeof cancelIdleCallback !== 'undefined'
				? cancelIdleCallback
				: (id: number) => window.clearTimeout(id);
		const idleId = schedule(() => {
			previewWorker.postMessage(payload);
		});
		return () => {
			cancel(idleId);
			previewWorker.removeEventListener('message', handleMessage);
			if (imageURL) {
				URL.revokeObjectURL(imageURL);
			}
		};
	});
</script>

<div class={classes}>
	{#if imageURL}
		<img src={imageURL} alt={die.id} />
	{/if}
</div>
