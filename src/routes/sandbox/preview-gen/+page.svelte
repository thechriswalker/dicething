<script lang="ts">
	// Dev/build helper: rasterise catalogue die previews for static/previews/.
	// Driven by scripts/generate_die_previews.ts via Playwright — not linked in the UI.
	import dice from '$lib/dice';
	import builtins, { loadBuiltinById } from '$lib/fonts';
	import type { Dice } from '$lib/interfaces/storage.svelte';
	import { requestDiePreview } from '$lib/utils/die_preview_client';
	import { legendPreviewSlug } from '$lib/utils/die_preview_static';
	import type { LegendSet } from '$lib/utils/legends';

	async function bitmapToWebpBase64(bitmap: ImageBitmap): Promise<string> {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('no 2d context');
		}
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
				'image/webp',
				0.9
			);
		});
		const buf = await blob.arrayBuffer();
		const bytes = new Uint8Array(buf);
		let binary = '';
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	async function renderOne(kind: string, legendKey: string): Promise<string> {
		const legendId = `builtin:${legendKey}`;
		const legends: LegendSet = await loadBuiltinById(legendId);
		const die: Dice = {
			id: `gen:${kind}:${legendKey}`,
			kind: kind as Dice['kind'],
			parameters: {},
			face_parameters: []
		};
		const bitmap = await requestDiePreview(die, legends);
		return bitmapToWebpBase64(bitmap);
	}

	function catalogue(): { kinds: string[]; legendKeys: string[] } {
		return {
			kinds: Object.keys(dice),
			legendKeys: Object.keys(builtins)
		};
	}

	$effect(() => {
		const w = window as unknown as {
			__dicethingPreviewCatalogue?: () => { kinds: string[]; legendKeys: string[] };
			__dicethingRenderPreview?: (kind: string, legendKey: string) => Promise<string>;
			__dicethingLegendSlug?: (legendKey: string) => string;
		};
		w.__dicethingPreviewCatalogue = catalogue;
		w.__dicethingRenderPreview = renderOne;
		w.__dicethingLegendSlug = (legendKey: string) =>
			legendPreviewSlug(`builtin:${legendKey}`);
	});
</script>

<p class="p-4 font-mono text-sm">Die preview generator — use <code>bun run generate:previews</code>.</p>
