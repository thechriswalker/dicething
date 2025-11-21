<script module lang="ts">
	import { browser } from '$app/environment';
	import PreviewWorker from '$lib/utils/die-previewer.worker?worker';

	let previewWorker: Worker;
	if (browser) {
		console.log('loading worker', PreviewWorker);
		previewWorker = new PreviewWorker({ name: 'preview-worker' });
	}
</script>

<script lang="ts">
	import { dieToJSON, type Dice } from '$lib/interfaces/storage.svelte';
	import type { LegendSet } from '$lib/utils/legends';

	const { die, legends }: { die: Dice; legends: LegendSet } = $props();

	let imageURL = $state('');

	$effect(() => {
		const handleMessage = (e: MessageEvent) => {
			if (e.data.id === die.id) {
				if (imageURL) {
					URL.revokeObjectURL(imageURL);
				}
				imageURL = e.data.url;
			}
		};
		console.log('adding message handler');
		previewWorker.addEventListener('message', handleMessage);
		previewWorker.postMessage({
			msg: 'die-preview',
			die: dieToJSON(die),
			legends: JSON.stringify(legends)
		});
		return () => {
			previewWorker.removeEventListener('message', handleMessage);
			if (imageURL) {
				URL.revokeObjectURL(imageURL);
			}
		};
	});
</script>

<div>
	{#if imageURL}
		<img src={imageURL} alt={die.id} />
	{/if}
</div>
