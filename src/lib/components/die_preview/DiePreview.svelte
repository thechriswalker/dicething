<script lang="ts">
	import { untrack } from 'svelte';
	import { dieToJSON, type Dice } from '$lib/interfaces/storage.svelte';
	import { ensureEngineWorker } from '$lib/utils/die_engine_client';
	import type { LegendSet } from '$lib/utils/legends';
	import {
		diePreviewPlaceholderUrl,
		resolveDiePreview
	} from '$lib/utils/die_preview_client';

	const {
		die,
		legends,
		enabled = true,
		class: classes = ''
	}: { die: Dice; legends: LegendSet; enabled?: boolean; class?: string } = $props();

	let imageURL = $state('');
	let revocable = $state(false);

	function clearUrl() {
		if (revocable && imageURL) {
			URL.revokeObjectURL(imageURL);
		}
		imageURL = '';
		revocable = false;
	}

	function setUrl(url: string, isRevocable: boolean) {
		if (revocable && imageURL && imageURL !== url) {
			URL.revokeObjectURL(imageURL);
		}
		imageURL = url;
		revocable = isRevocable;
	}

	$effect(() => {
		// die is mutated in place by the editor — track contents, not identity.
		const dieJson = dieToJSON(die);
		const legendId = legends.id;
		const legendUpdated =
			'updated' in legends ? (legends as { updated?: number }).updated : undefined;
		const payload = { die, legends, enabled, dieJson, legendId, legendUpdated };
		let cancelled = false;
		if (!payload.enabled) {
			return;
		}
		ensureEngineWorker();

		// Only flash a placeholder when we have nothing to show yet. Re-running this
		// effect (parent churn) used to reset every tile back to blanks.webp and
		// cancel the in-flight worker render — so custom / non-default dice never
		// upgraded past the blank shape.
		const placeholder = diePreviewPlaceholderUrl(payload.die, payload.legends);
		untrack(() => {
			if (placeholder && !imageURL) {
				setUrl(placeholder, false);
			}
		});

		// Resolve immediately — heavy work is in the preview worker queue. An idle
		// callback here was cancelled on every parent re-render and often never ran.
		void resolveDiePreview(payload.die, payload.legends)
			.then((resolved) => {
				if (cancelled) {
					if (resolved.revocable) {
						URL.revokeObjectURL(resolved.url);
					}
					return;
				}
				untrack(() => {
					if (resolved.source === 'static' && imageURL === resolved.url && !revocable) {
						return;
					}
					setUrl(resolved.url, resolved.revocable);
				});
			})
			.catch((e) => console.warn('die preview failed', payload.die.id, e));

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		return () => clearUrl();
	});
</script>

<div class={classes}>
	{#if imageURL}
		<img src={imageURL} alt={die.id} class="h-full w-full object-contain" />
	{/if}
</div>
