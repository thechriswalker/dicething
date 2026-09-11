<script lang="ts">
	import FontContourInspect from '$lib/components/font_inspect/FontContourInspect.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import builtins from '$lib/fonts';
	import { defaultStrings, inspectFontString } from '$lib/utils/font';

	type ScanRow = {
		text: string;
		empty: boolean;
		warnings: Array<string>;
		svgErrors: number;
		shapes: number;
	};

	let buffer = $state<ArrayBuffer | undefined>(undefined);
	let fontLabel = $state('No font loaded');
	let builtinKey = $state<string>('');
	let text = $state('8');
	let letterSpacing = $state(0);
	let loading = $state(false);
	let loadError = $state('');
	let scanning = $state(false);
	let scanRows = $state<Array<ScanRow>>([]);
	let scanNote = $state('');

	const builtinEntries = Object.entries(builtins).filter(([, b]) => b.fontUrl);

	async function loadBuiltin() {
		loadError = '';
		scanRows = [];
		const b = builtins[builtinKey as keyof typeof builtins];
		if (!b?.fontUrl) {
			loadError = 'Pick a builtin with a font file.';
			return;
		}
		loading = true;
		try {
			const res = await fetch(b.fontUrl);
			buffer = await res.arrayBuffer();
			fontLabel = `${b.name} (builtin)`;
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
			buffer = undefined;
		} finally {
			loading = false;
		}
	}

	async function onFile(e: Event) {
		loadError = '';
		scanRows = [];
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			return;
		}
		loading = true;
		try {
			buffer = await file.arrayBuffer();
			fontLabel = file.name;
			builtinKey = '';
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
			buffer = undefined;
		} finally {
			loading = false;
		}
	}

	async function scanDefaultTokens() {
		if (!buffer || scanning) {
			return;
		}
		scanning = true;
		scanNote = '';
		scanRows = [];
		await new Promise((r) => setTimeout(r, 0));
		const tokens = defaultStrings.split(' ').filter(Boolean);
		const rows: Array<ScanRow> = [];
		let problemCount = 0;
		for (const token of tokens) {
			try {
				const info = inspectFontString(buffer, token, { letterSpacing });
				const svgErrors =
					info.stats.raw.svgErrors.length +
					info.stats.resolved.svgErrors.length +
					info.stats.centered.svgErrors.length;
				const empty = info.centeredShapes.length === 0;
				const interesting = empty || info.warnings.length > 0 || svgErrors > 0;
				if (interesting) {
					problemCount++;
					rows.push({
						text: token,
						empty,
						warnings: info.warnings,
						svgErrors,
						shapes: info.centeredShapes.length
					});
				}
			} catch (e) {
				problemCount++;
				rows.push({
					text: token,
					empty: true,
					warnings: [e instanceof Error ? e.message : String(e)],
					svgErrors: 0,
					shapes: 0
				});
			}
		}
		scanRows = rows;
		scanNote =
			problemCount === 0
				? `All ${tokens.length} default tokens produced shapes.`
				: `${problemCount} of ${tokens.length} default tokens look problematic.`;
		scanning = false;
	}

	function pickScanToken(token: string) {
		text = token;
	}
</script>

<Layout>
	{#snippet header()}
		<a class="btn btn-sm preset-tonal-surface" href="/sandbox">Mesh sandbox</a>
		<h1 class="h4 text-primary-500">Font contour inspect</h1>
	{/snippet}

	<div class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
		<p class="text-surface-600-400 text-sm">
			Dev tool: compare raw font contours vs resolveShapeBoundaries vs the centered shapes we
			store. Use this when a glyph imports blank or fails to render as SVG. Also available on a
			font-sourced slot in the legend editor when developer mode is on.
		</p>

		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<label class="label">
				<span class="label-text">Builtin font</span>
				<div class="flex gap-2">
					<select class="select flex-1" bind:value={builtinKey}>
						<option value="">—</option>
						{#each builtinEntries as [key, b]}
							<option value={key}>{b.name}</option>
						{/each}
					</select>
					<button
						type="button"
						class="btn preset-tonal-surface"
						disabled={!builtinKey || loading}
						onclick={loadBuiltin}
					>
						Load
					</button>
				</div>
			</label>

			<label class="label">
				<span class="label-text">Or upload TTF/OTF</span>
				<input
					class="input"
					type="file"
					accept=".ttf,.otf,font/ttf,font/otf"
					onchange={onFile}
				/>
			</label>
		</div>

		{#if loadError}
			<p class="text-error-500 text-sm">{loadError}</p>
		{/if}
		<p class="text-surface-600-400 text-xs">
			{loading ? 'Loading…' : fontLabel}
			{#if buffer}
				· {(buffer.byteLength / 1024).toFixed(1)} KiB
			{/if}
		</p>

		{#if buffer}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<label class="label sm:col-span-2">
					<span class="label-text">Characters</span>
					<input class="input font-mono" type="text" bind:value={text} />
				</label>
				<label class="label">
					<span class="label-text">Letter spacing (em)</span>
					<input
						class="input"
						type="number"
						step="0.01"
						bind:value={letterSpacing}
					/>
				</label>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="btn preset-tonal-surface"
					disabled={scanning}
					onclick={scanDefaultTokens}
				>
					{scanning ? 'Scanning…' : 'Scan default legend tokens'}
				</button>
				{#if scanNote}
					<span class="text-surface-600-400 text-xs">{scanNote}</span>
				{/if}
			</div>

			{#if scanRows.length > 0}
				<div class="overflow-x-auto rounded border">
					<table class="table table-sm w-full text-xs">
						<thead>
							<tr>
								<th>token</th>
								<th>shapes</th>
								<th>svg errs</th>
								<th>warnings</th>
							</tr>
						</thead>
						<tbody>
							{#each scanRows as row}
								<tr>
									<td>
										<button
											type="button"
											class="btn btn-sm preset-tonal-primary-500 font-mono"
											onclick={() => pickScanToken(row.text)}
										>
											{row.text}
										</button>
										{#if row.empty}
											<span class="text-error-500 ml-1">empty</span>
										{/if}
									</td>
									<td>{row.shapes}</td>
									<td class={row.svgErrors ? 'text-error-500' : ''}>{row.svgErrors}</td>
									<td class="text-surface-600-400 max-w-md truncate">
										{row.warnings.join(' · ') || '—'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<div class="rounded border p-3">
				<FontContourInspect {buffer} {text} {letterSpacing} />
			</div>
		{/if}
	</div>
</Layout>
