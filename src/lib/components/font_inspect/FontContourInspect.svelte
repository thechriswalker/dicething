<script lang="ts">
	import ShapeStagePreview from '$lib/components/font_inspect/ShapeStagePreview.svelte';
	import {
		inspectFontString,
		type FontStringInspect,
		type FontShapeStageStats
	} from '$lib/utils/font';
	import { shapeToJSON } from '$lib/utils/to_json';

	let {
		buffer,
		text,
		letterSpacing = 0
	}: {
		buffer: ArrayBufferLike;
		text: string;
		letterSpacing?: number;
	} = $props();

	let inspectResult = $derived.by((): { ok: FontStringInspect } | { error: string } | null => {
		if (!text) {
			return null;
		}
		try {
			return { ok: inspectFontString(buffer, text, { letterSpacing }) };
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) };
		}
	});
	let inspect = $derived(
		inspectResult && 'ok' in inspectResult ? inspectResult.ok : null
	);
	let inspectError = $derived(
		inspectResult && 'error' in inspectResult ? inspectResult.error : null
	);

	let copied = $state('');
	async function copyText(label: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = label;
			setTimeout(() => {
				if (copied === label) {
					copied = '';
				}
			}, 1200);
		} catch {
			/* clipboard unavailable */
		}
	}

	function stageLabel(key: 'raw' | 'resolved' | 'centered'): string {
		switch (key) {
			case 'raw':
				return 'Raw contours';
			case 'resolved':
				return 'After resolve';
			case 'centered':
				return 'Centered (stored)';
		}
	}

	function statsLine(s: FontShapeStageStats): string {
		const err =
			s.svgErrors.length > 0 ? ` · ${s.svgErrors.length} SVG error(s)` : '';
		return `${s.shapeCount} shapes · ${s.holeCount} holes · ${s.curveCount} curves${err}`;
	}
</script>

{#if !text}
	<p class="text-surface-600-400 text-sm">Enter characters to inspect.</p>
{:else if inspectError}
	<p class="text-error-500 text-sm">{inspectError}</p>
{:else if inspect}
	<div class="flex flex-col gap-3">
		{#if inspect.warnings.length > 0}
			<ul class="bg-warning-500/15 text-warning-700-300 list-inside list-disc rounded p-2 text-xs">
				{#each inspect.warnings as w}
					<li>{w}</li>
				{/each}
			</ul>
		{/if}

		<div class="text-surface-600-400 flex flex-wrap gap-x-4 gap-y-1 text-xs">
			<span>unitsPerEm {inspect.unitsPerEm}</span>
			<span>scale {inspect.scale.toFixed(6)}</span>
			<span>{inspect.glyphs.length} shaped glyph(s)</span>
		</div>

		{#if inspect.glyphs.length > 0}
			<div class="overflow-x-auto">
				<table class="table table-sm w-full text-xs">
					<thead>
						<tr>
							<th>glyphId</th>
							<th>contours</th>
							<th>points</th>
							<th>advance</th>
							<th>offset</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each inspect.glyphs as g}
							<tr class={g.empty ? 'text-error-500' : ''}>
								<td class="font-mono">{g.glyphId}</td>
								<td>{g.contourCount ?? '—'}</td>
								<td>{g.pointCount}</td>
								<td class="font-mono"
									>{g.xAdvance.toFixed(1)},{g.yAdvance.toFixed(1)}</td
								>
								<td class="font-mono"
									>{g.xOffset.toFixed(1)},{g.yOffset.toFixed(1)}</td
								>
								<td>{g.empty ? 'empty' : ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
			{#each (['raw', 'resolved', 'centered'] as const) as key}
				{@const shapes =
					key === 'raw'
						? inspect.rawShapes
						: key === 'resolved'
							? inspect.resolvedShapes
							: inspect.centeredShapes}
				{@const stats = inspect.stats[key]}
				<div class="flex flex-col gap-1">
					<div class="flex items-center justify-between gap-1">
						<span class="text-sm font-semibold">{stageLabel(key)}</span>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							onclick={() =>
								copyText(key, JSON.stringify(shapes.map((s) => shapeToJSON(s))))}
						>
							{copied === key ? 'Copied' : 'JSON'}
						</button>
					</div>
					<span class="text-surface-600-400 text-xs">{statsLine(stats)}</span>
					{#if stats.svgErrors.length > 0}
						<ul class="text-error-500 list-inside list-disc text-xs">
							{#each stats.svgErrors as err}
								<li>{err}</li>
							{/each}
						</ul>
					{/if}
					<ShapeStagePreview {shapes} />
				</div>
			{/each}
		</div>

		<div class="flex flex-col gap-1">
			<div class="flex items-center justify-between">
				<span class="text-sm font-semibold">Stored JSON</span>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => copyText('stored', JSON.stringify(inspect.json))}
				>
					{copied === 'stored' ? 'Copied' : 'Copy'}
				</button>
			</div>
			<textarea
				class="textarea h-24 w-full font-mono text-xs"
				readonly
				onclick={(e) => e.currentTarget.select()}
				value={JSON.stringify(inspect.json)}
			></textarea>
		</div>
	</div>
{/if}
