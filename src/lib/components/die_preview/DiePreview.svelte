<script lang="ts">
	import { dieToJSON, type Dice } from '$lib/interfaces/storage.svelte';
	import { ensureEngineWorker } from '$lib/utils/die_engine_client';
	import type { LegendSet } from '$lib/utils/legends';
	import { requestDiePreview } from '$lib/utils/die_preview_client';

	const {
		die,
		legends,
		enabled = true,
		class: classes = ''
	}: { die: Dice; legends: LegendSet; enabled?: boolean; class?: string } = $props();

	let imageURL = $state('');

	$effect(() => {
		// die is mutated in place by the editor — track contents, not identity.
		const dieJson = dieToJSON(die);
		const legendId = legends.id;
		const legendUpdated = 'updated' in legends ? (legends as { updated?: number }).updated : undefined;
		const payload = { die, legends, enabled, dieJson, legendId, legendUpdated };
		let cancelled = false;
		if (!payload.enabled) {
			return;
		}
		ensureEngineWorker();
		const schedule =
			typeof requestIdleCallback !== 'undefined'
				? (cb: () => void) => requestIdleCallback(cb, { timeout: 2000 })
				: (cb: () => void) => window.setTimeout(cb, 0);
		const cancel =
			typeof cancelIdleCallback !== 'undefined'
				? cancelIdleCallback
				: (id: number) => window.clearTimeout(id);
		const idleId = schedule(() => {
			void requestDiePreview(payload.die, payload.legends)
				.then(async (bitmap) => {
					if (cancelled || bitmap.width === 0 || bitmap.height === 0) {
						bitmap.close();
						return;
					}
					if (imageURL) {
						URL.revokeObjectURL(imageURL);
					}
					const canvas = document.createElement('canvas');
					canvas.width = bitmap.width;
					canvas.height = bitmap.height;
					const ctx = canvas.getContext('2d');
					ctx?.drawImage(bitmap, 0, 0);
					bitmap.close();
					const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
					if (blob && !cancelled) {
						imageURL = URL.createObjectURL(blob);
					}
				})
				.catch((e) => console.warn('die preview failed', payload.die.id, e));
		});
		return () => {
			cancelled = true;
			cancel(idleId);
		};
	});
</script>

<div class={classes}>
	{#if imageURL}
		<img src={imageURL} alt={die.id} class="h-full w-full object-contain" />
	{/if}
</div>
