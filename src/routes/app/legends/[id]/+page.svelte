<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import Layout from '$lib/components/layout/Layout.svelte';
	import LegendPreview from '$lib/components/legend_viewer/LegendPreview.svelte';
	import LegendViewer from '$lib/components/legend_viewer/LegendViewer.svelte';
	import ShapesPreview from '$lib/components/legend_viewer/ShapesPreview.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import builtins, { type Builtin } from '$lib/fonts';
	import {
		getCustomLegendSet,
		getSavedLegends,
		saveLegendSet
	} from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		combineImportPieces,
		getEditableFont,
		shapesFromFontText,
		shapesFromSVG,
		svgImportPieces,
		svgUnsupportedElements,
		type SvgPiece,
		type SvgPieceAction
	} from '$lib/utils/create_legends';
	import { StrokeOnlySVGError } from '$lib/utils/font';
	import { debounce } from '$lib/utils/debounce';
	import {
		debugLegendName,
		Legend,
		loadMutableLegends,
		type LegendSet,
		type MutableLegendSet
	} from '$lib/utils/legends';
	import { shapeToJSON } from '$lib/utils/to_json';
	import { addUnderline, defaultUnderline } from '$lib/utils/underline';
	import { ArrowLeftIcon, ImageIcon, PlusIcon, SaveIcon, Trash2Icon, TypeIcon } from '@lucide/svelte';

	let id = $derived(page.params.id ?? '');
	let returnTo = $derived(page.url.searchParams.get('return') || '/legends');

	// The editor owns a live instance (kept in sync with the store via autosave).
	// It's loaded once per id and may carry a trailing blank slot you're mid-way
	// through adding; the persisted copy trims those (see trimmedForStore).
	let set = $state<MutableLegendSet | undefined>(undefined);
	let loadedSetId = '';
	$effect(() => {
		if (id === loadedSetId) {
			return;
		}
		loadedSetId = id;
		set = getCustomLegendSet(id);
	});
	let selectedLegend = $state<Legend>(Legend.ONE);
	// bumped after any edit so the previews (which read from a non-reactive
	// legend set) re-render.
	let version = $state(0);

	// the source font for this set (builtin from bundle / uploaded from IDB),
	// loaded once so we can re-render glyphs from text.
	let fontBuffer = $state<ArrayBuffer | undefined>(undefined);
	let fontBufferForId = '';
	$effect(() => {
		if (set && set.id !== fontBufferForId) {
			fontBufferForId = set.id;
			fontBuffer = undefined;
			getEditableFont(set).then((b) => (fontBuffer = b));
		}
	});

	// editable set name
	let name = $state('');
	let lastNameId = '';
	$effect(() => {
		if (set && set.id !== lastNameId) {
			lastNameId = set.id;
			name = set.name;
		}
	});
	function onNameInput() {
		if (set) {
			set.name = name;
			commit();
		}
	}

	// per-legend editable fields, synced when the selected slot changes.
	let charText = $state('');
	let letterSpacing = $state(0);
	let underlineOn = $state(false);
	let underlineThickness = $state(defaultUnderline.thickness);
	let underlineGap = $state(defaultUnderline.gap);
	let underlineWidth = $state(defaultUnderline.widthScale);
	let underlineFlip = $state(defaultUnderline.flip);

	let lastSyncedKey = '';
	$effect(() => {
		if (!set) {
			return;
		}
		const key = set.id + ':' + selectedLegend;
		if (key === lastSyncedKey) {
			return;
		}
		lastSyncedKey = key;
		const src = set.getSource(selectedLegend);
		if (src?.kind === 'font') {
			charText = src.text;
			letterSpacing = src.letterSpacing ?? 0;
			const u = src.underline;
			underlineOn = !!u;
			underlineThickness = u?.thickness ?? defaultUnderline.thickness;
			underlineGap = u?.gap ?? defaultUnderline.gap;
			underlineWidth = u?.widthScale ?? defaultUnderline.widthScale;
			underlineFlip = u?.flip ?? defaultUnderline.flip;
		} else {
			charText = '';
			letterSpacing = 0;
			underlineOn = false;
			underlineThickness = defaultUnderline.thickness;
			underlineGap = defaultUnderline.gap;
			underlineWidth = defaultUnderline.widthScale;
			underlineFlip = defaultUnderline.flip;
		}
	});

	// --- autosave -----------------------------------------------------------
	// Edits autosave (debounced). The persisted copy is always trimmed of trailing
	// blank slots so the builder/legend picker never see empty entries, while the
	// live editor set keeps any trailing blank you're part-way through adding.
	let saving = $state(false);

	// Trim *trailing* blank (shape-less) slots for storage. Interior blanks are
	// preserved so later legends keep their index (trimming them would re-order
	// the set).
	function trimmedForStore(s: MutableLegendSet): MutableLegendSet {
		const json = s.toJSON();
		let len = json.shapes.length;
		while (len > 0 && (json.shapes[len - 1]?.length ?? 0) === 0) {
			len--;
		}
		return loadMutableLegends({
			...json,
			shapes: json.shapes.slice(0, len),
			names: json.names.slice(0, len),
			sources: (json.sources ?? []).slice(0, len)
		});
	}

	function doPersist() {
		if (set) {
			saveLegendSet(trimmedForStore(set));
		}
		saving = false;
	}
	const persistDebounced = debounce<void>(400, doPersist);

	// mark an edit: refresh previews, show the saving indicator and schedule a save.
	function commit() {
		version++;
		saving = true;
		persistDebounced();
	}

	// Never lose edits when leaving the editor (e.g. returning to the builder):
	// flush pending regeneration + save so the builder reads the latest shapes.
	beforeNavigate(() => {
		regenerateDebounced.flush();
		persistDebounced.flush();
	});

	// append a new, blank legend slot to the set and select it for editing.
	function addLegend() {
		if (!set) {
			return;
		}
		const idx = set.length;
		set.setSerialized(idx, debugLegendName(idx), [], null);
		selectedLegend = idx;
		commit();
	}

	// delete the selected legend. The final slot is removed entirely; an interior
	// slot is converted to a blank so later legends keep their index. Trailing
	// blanks left behind are trimmed when persisted (trimmedForStore).
	function deleteLegend(l: Legend) {
		if (!set) {
			return;
		}
		const last = set.length - 1;
		if (l >= last) {
			const json = set.toJSON();
			set = loadMutableLegends({
				...json,
				shapes: json.shapes.slice(0, last),
				names: json.names.slice(0, last),
				sources: (json.sources ?? []).slice(0, last)
			});
		} else {
			set.setSerialized(l, debugLegendName(l), [], null);
		}
		if (selectedLegend > set.length - 1) {
			selectedLegend = Math.max(0, set.length - 1);
		}
		commit();
	}

	// (re)generate the selected slot from the set's source font using the
	// current characters / letter-spacing / underline settings.
	function regenerateFromFont() {
		if (!set || !fontBuffer || !charText) {
			return;
		}
		const base = shapesFromFontText(fontBuffer, charText, letterSpacing || undefined);
		const underline = underlineOn
			? {
					thickness: underlineThickness,
					gap: underlineGap,
					widthScale: underlineWidth,
					flip: underlineFlip
				}
			: undefined;
		const shapes = underline ? addUnderline(base, underline) : base;
		set.setSerialized(selectedLegend, set.getLegendName(selectedLegend), shapes, {
			kind: 'font',
			text: charText,
			letterSpacing: letterSpacing || undefined,
			underline
		});
		commit();
	}
	const regenerateDebounced = debounce<void>(200, () => regenerateFromFont());

	// SVG import. The simple path previews the "border" (filled boundary)
	// interpretation. If that's wrong, the complex importer splits the SVG into
	// individual pieces (compound paths separated) that can each be traced,
	// filled or ignored.
	let svgText = $state('');
	let svgBorder = $state<Array<unknown> | null>(null);
	let svgNote = $state('');
	let svgUnsupported = $state<Array<string>>([]);
	let complexOpen = $state(false);
	let pieces = $state<Array<SvgPiece>>([]);
	let pieceActions = $state<Array<SvgPieceAction>>([]);

	function resetImport() {
		svgText = '';
		svgBorder = null;
		svgNote = '';
		svgUnsupported = [];
		complexOpen = false;
		pieces = [];
		pieceActions = [];
	}

	async function onSvgFilePicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		resetImport();
		if (!file) {
			return;
		}
		svgText = await file.text();
		svgUnsupported = svgUnsupportedElements(svgText);
		try {
			const b = shapesFromSVG(svgText);
			svgBorder = b.length ? b : null;
			if (!svgBorder) {
				svgNote = m.legends_editor_svg_empty();
			}
		} catch (e) {
			svgNote =
				e instanceof StrokeOnlySVGError
					? m.legends_editor_svg_stroke_only()
					: m.legends_editor_svg_error({ error: e instanceof Error ? e.message : String(e) });
			svgBorder = null;
		}
	}

	function openComplex() {
		if (!svgText) {
			return;
		}
		pieces = svgImportPieces(svgText);
		pieceActions = pieces.map((p) => p.defaultAction);
		complexOpen = true;
	}

	function pieceShapes(piece: SvgPiece, action: SvgPieceAction): Array<unknown> {
		if (action === 'traceOutline') {
			return piece.traceOutline ?? [];
		}
		if (action === 'usePath') {
			return piece.usePath ?? [];
		}
		if (action === 'fillPath') {
			return piece.fillPath ?? [];
		}
		return [];
	}

	// What to show in a piece thumbnail (preview the would-be selection even when
	// currently ignored).
	function piecePreviewShapes(piece: SvgPiece, action: SvgPieceAction): Array<unknown> {
		if (action !== 'ignore') {
			return pieceShapes(piece, action);
		}
		return piece.usePath ?? piece.traceOutline ?? piece.fillPath ?? [];
	}

	let complexCombined = $derived(
		pieces.flatMap((p, i) => pieceShapes(p, pieceActions[i] ?? 'ignore'))
	);

	function applyShapes(shapes: Array<unknown>, close: () => void) {
		if (!set || shapes.length === 0) {
			return;
		}
		set.setSerialized(selectedLegend, set.getLegendName(selectedLegend), shapes, { kind: 'svg' });
		commit();
		resetImport();
		close();
	}

	// --- copy a glyph from another legend set --------------------------------
	let copySource = $state<LegendSet | undefined>(undefined);
	const savedLegends = getSavedLegends();
	let otherCustom = $derived(savedLegends.filter((s) => s.id !== id));
	const otherBuiltins = Object.values(builtins).filter((b) => b.id !== 'blanks');

	async function pickCopySourceBuiltin(b: Builtin) {
		copySource = await b.load();
	}
	function pickCopySourceCustom(s: LegendSet) {
		copySource = s;
	}
	function copyGlyph(srcLegend: Legend, close: () => void) {
		if (!set || !copySource) {
			return;
		}
		const shapes = copySource.get(srcLegend).map(shapeToJSON);
		set.setSerialized(selectedLegend, set.getLegendName(selectedLegend), shapes, {
			kind: 'glyph',
			from: copySource.id,
			legend: srcLegend
		});
		commit();
		close();
	}

	// --- load an ad-hoc font just to grab a glyph ----------------------------
	let adhocBuffer = $state<ArrayBuffer | undefined>(undefined);
	let adhocText = $state('');
	async function onAdhocFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			return;
		}
		adhocBuffer = await file.arrayBuffer();
	}
	function applyAdhoc(close: () => void) {
		if (!set || !adhocBuffer || !adhocText) {
			return;
		}
		const shapes = shapesFromFontText(adhocBuffer, adhocText);
		set.setSerialized(selectedLegend, set.getLegendName(selectedLegend), shapes, null);
		commit();
		close();
	}

	let fontSource = $derived.by(() => {
		const f = set?.font;
		if (!f) {
			return m.legends_editor_no_font();
		}
		if (f.kind === 'builtin') {
			const b = builtins[f.builtinId as keyof typeof builtins];
			return m.legends_editor_builtin_font({ name: b?.name ?? f.builtinId });
		}
		return m.legends_editor_uploaded_font();
	});
</script>

<Layout>
	{#snippet header()}
		<a class="btn btn-sm preset-tonal-surface" href={returnTo}>
			<ArrowLeftIcon class="size-4" />
			{m.legends_back()}
		</a>
		<h1 class="h4 text-primary-500">{set?.name ?? m.legends_title()}</h1>
		{#if saving}
			<SaveIcon class="text-surface-500 size-4 animate-pulse" />
		{/if}
	{/snippet}

	<div class="mx-auto w-full max-w-5xl p-4">
		{#if !set}
			<p class="card preset-filled-error-500 px-3 py-2">{m.legends_editor_not_found()}</p>
			<button class="btn preset-tonal-primary mt-4" onclick={() => goto('/legends')}>
				<ArrowLeftIcon class="size-4" />
				{m.legends_back()}
			</button>
		{:else}
			<div class="flex flex-col gap-4">
				<label class="label max-w-md">
					<span class="label-text">{m.legends_editor_set_name()}</span>
					<input class="input" type="text" bind:value={name} oninput={onNameInput} />
				</label>
				<p class="text-surface-600-400 text-sm">{m.legends_editor_font_source()}: {fontSource}</p>

				<div class="grid grid-cols-1 gap-4 md:grid-cols-[1fr_20rem]">
					<!-- legend grid -->
					<div class="card preset-filled-surface-100-900 p-3">
						{#key version}
							<LegendViewer
								legends={set}
								{selectedLegend}
								onSelectedLegend={(l) => (selectedLegend = l)}
							>
								{#snippet append()}
									<button
										type="button"
										class="chip btn preset-tonal-surface h-16 w-16 flex-col gap-1"
										title={m.legends_editor_add_legend()}
										onclick={addLegend}
									>
										<PlusIcon class="size-6" />
									</button>
								{/snippet}
							</LegendViewer>
						{/key}
					</div>

					<!-- selected legend editor -->
					<div class="card preset-filled-surface-100-900 flex flex-col gap-3 p-3">
						<div class="flex flex-col items-center gap-1">
							{#key selectedLegend + ':' + version}
								<LegendPreview legends={set} legend={selectedLegend} class="size-28" />
							{/key}
							<div class="flex items-center gap-2">
								<span class="font-semibold">{set.getLegendName(selectedLegend)}</span>
								{#if set.length > 0}
									<button
										type="button"
										class="btn-icon btn-icon-sm preset-tonal-error"
										title={m.legends_editor_delete_legend()}
										onclick={() => deleteLegend(selectedLegend)}
									>
										<Trash2Icon class="size-4" />
									</button>
								{/if}
							</div>
						</div>

						{#if fontBuffer}
							<fieldset class="flex flex-col gap-2 border-t pt-2">
								<legend class="text-sm font-semibold">{m.legends_editor_from_font()}</legend>
								<label class="label">
									<span class="label-text">{m.legends_editor_characters()}</span>
									<input
										class="input"
										type="text"
										bind:value={charText}
										oninput={() => regenerateDebounced()}
									/>
								</label>
								<label class="label">
									<span class="label-text">
										{m.legends_editor_letter_spacing()}: {letterSpacing.toFixed(2)}
									</span>
									<input
										type="range"
										min="-0.5"
										max="0.5"
										step="0.01"
										bind:value={letterSpacing}
										oninput={() => regenerateDebounced()}
									/>
								</label>

								<label class="flex flex-row items-center gap-2">
									<input
										type="checkbox"
										class="checkbox"
										bind:checked={underlineOn}
										onchange={() => regenerateFromFont()}
									/>
									<span>{m.legends_editor_underline()}</span>
								</label>
								{#if underlineOn}
									<label class="label">
										<span class="label-text">
											{m.legends_editor_underline_thickness()}: {underlineThickness.toFixed(2)}
										</span>
										<input
											type="range"
											min="0.1"
											max="2"
											step="0.05"
											bind:value={underlineThickness}
											oninput={() => regenerateDebounced()}
										/>
									</label>
									<label class="label">
										<span class="label-text">
											{m.legends_editor_underline_gap()}: {underlineGap.toFixed(2)}
										</span>
										<input
											type="range"
											min="-1"
											max="3"
											step="0.05"
											bind:value={underlineGap}
											oninput={() => regenerateDebounced()}
										/>
									</label>
									<label class="label">
										<span class="label-text">
											{m.legends_editor_underline_width()}: {underlineWidth.toFixed(2)}
										</span>
										<input
											type="range"
											min="0.2"
											max="1.5"
											step="0.05"
											bind:value={underlineWidth}
											oninput={() => regenerateDebounced()}
										/>
									</label>
									<label class="flex flex-row items-center gap-2">
										<input
											type="checkbox"
											class="checkbox"
											bind:checked={underlineFlip}
											onchange={() => regenerateFromFont()}
										/>
										<span>{m.legends_editor_underline_flip()}</span>
									</label>
								{/if}
							</fieldset>
						{/if}

						<div class="flex flex-col gap-2 border-t pt-2">
							<span class="text-sm font-semibold">{m.legends_editor_replace_with()}</span>
							<!-- import SVG: border first, complex (per-piece) on demand -->
							<Modal>
								{#snippet title()}
									{m.legends_editor_import_svg()}
								{/snippet}
								{#snippet trigger(props)}
									<button {...props} type="button" class="btn preset-tonal-surface w-full justify-start">
										<ImageIcon class="size-4" />
										{m.legends_editor_import_svg()}
									</button>
								{/snippet}
								{#snippet inner(close)}
									<div class="flex w-[34rem] max-w-full flex-col gap-3">
										<label class="label">
											<span class="label-text">{m.legends_editor_svg_choose()}</span>
											<input
												class="input"
												type="file"
												accept=".svg,image/svg+xml"
												onchange={onSvgFilePicked}
											/>
										</label>
										{#if svgUnsupported.length}
											<div
												class="preset-tonal-warning rounded p-2 text-sm"
												role="note"
											>
												{m.legends_editor_svg_unsupported({
													elements: svgUnsupported.join(', ')
												})}
											</div>
										{/if}
										{#if svgNote}
											<p class="text-warning-700-300 text-sm">{svgNote}</p>
										{/if}

										{#if !complexOpen}
											{#if svgBorder}
												<div class="flex flex-col items-center gap-2">
													<span class="text-sm font-semibold">{m.legends_editor_svg_border()}</span>
													<ShapesPreview shapes={svgBorder} class="size-28" />
													<button
														type="button"
														class="btn btn-sm preset-filled-primary-500"
														onclick={() => applyShapes(svgBorder!, close)}
													>
														{m.legends_editor_svg_use_border()}
													</button>
												</div>
											{/if}
											{#if svgText}
												<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
													<p class="text-surface-600-400 text-sm">
														{svgBorder
															? m.legends_editor_svg_complex_hint_some()
															: m.legends_editor_svg_complex_hint_none()}
													</p>
													<button
														type="button"
														class="btn btn-sm preset-tonal-surface self-start"
														onclick={openComplex}
													>
														{m.legends_editor_svg_open_complex()}
													</button>
												</div>
											{/if}
										{:else}
											<!-- complex import: per-piece trace / fill / ignore -->
											<div class="flex flex-col items-center gap-1">
												<span class="text-sm font-semibold">{m.legends_editor_svg_result()}</span>
												{#if complexCombined.length}
													<ShapesPreview shapes={complexCombined} class="size-28" />
												{:else}
													<p class="text-surface-500 text-xs">{m.legends_editor_svg_empty()}</p>
												{/if}
											</div>
											<div class="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
												{#each pieces as piece, i (i)}
													<div
														class="border-surface-200-800 flex items-center gap-3 rounded border p-2"
													>
														<div
															class="bg-surface-100-900 size-12 shrink-0 rounded {pieceActions[i] ===
															'ignore'
																? 'opacity-30'
																: ''}"
														>
															<ShapesPreview
																shapes={piecePreviewShapes(piece, pieceActions[i])}
																class="size-12"
															/>
														</div>
														<span class="text-surface-600-400 w-10 text-xs">{piece.label}</span>
														<div class="ml-auto flex flex-wrap justify-end gap-1">
															<button
																type="button"
																class="btn btn-sm {pieceActions[i] === 'traceOutline'
																	? 'preset-filled-primary-500'
																	: 'preset-tonal-surface'}"
																disabled={!piece.traceOutline}
																title={m.legends_editor_svg_trace_outline_help()}
																onclick={() => (pieceActions[i] = 'traceOutline')}
															>
																{m.legends_editor_svg_trace_outline()}
															</button>
															<button
																type="button"
																class="btn btn-sm {pieceActions[i] === 'usePath'
																	? 'preset-filled-primary-500'
																	: 'preset-tonal-surface'}"
																disabled={!piece.usePath}
																title={m.legends_editor_svg_use_path_help()}
																onclick={() => (pieceActions[i] = 'usePath')}
															>
																{m.legends_editor_svg_use_path()}
															</button>
															<button
																type="button"
																class="btn btn-sm {pieceActions[i] === 'fillPath'
																	? 'preset-filled-primary-500'
																	: 'preset-tonal-surface'}"
																disabled={!piece.fillPath}
																title={m.legends_editor_svg_fill_path_help()}
																onclick={() => (pieceActions[i] = 'fillPath')}
															>
																{m.legends_editor_svg_fill_path()}
															</button>
															<button
																type="button"
																class="btn btn-sm {pieceActions[i] === 'ignore'
																	? 'preset-filled-surface-500'
																	: 'preset-tonal-surface'}"
																onclick={() => (pieceActions[i] = 'ignore')}
															>
																{m.legends_editor_svg_ignore()}
															</button>
														</div>
													</div>
												{/each}
											</div>
											<button
												type="button"
												class="btn preset-filled-primary-500"
												disabled={complexCombined.length === 0}
												onclick={() => applyShapes(combineImportPieces(complexCombined), close)}
											>
												{m.legends_editor_apply()}
											</button>
										{/if}
									</div>
								{/snippet}
							</Modal>

							<!-- copy from another set -->
							<Modal>
								{#snippet title()}
									{m.legends_editor_copy_from_set()}
								{/snippet}
								{#snippet trigger(props)}
									<button {...props} type="button" class="btn preset-tonal-surface w-full justify-start">
										<TypeIcon class="size-4" />
										{m.legends_editor_copy_from_set()}
									</button>
								{/snippet}
								{#snippet inner(close)}
									<div class="flex max-h-[70vh] w-[36rem] max-w-full flex-col gap-3 overflow-y-auto">
										<div class="flex flex-row flex-wrap gap-2">
											{#each otherCustom as s (s.id)}
												<button
													class="btn btn-sm preset-tonal-primary"
													onclick={() => pickCopySourceCustom(s)}>{s.name}</button
												>
											{/each}
											{#each otherBuiltins as b (b.id)}
												<button
													class="btn btn-sm preset-tonal-surface"
													onclick={() => pickCopySourceBuiltin(b)}>{b.name}</button
												>
											{/each}
										</div>
										{#if copySource}
											<LegendViewer
												legends={copySource}
												onSelectedLegend={(l) => copyGlyph(l, close)}
											/>
										{/if}
									</div>
								{/snippet}
							</Modal>

							<!-- ad-hoc font -->
							<Modal>
								{#snippet title()}
									{m.legends_editor_from_other_font()}
								{/snippet}
								{#snippet trigger(props)}
									<button {...props} type="button" class="btn preset-tonal-surface w-full justify-start">
										<TypeIcon class="size-4" />
										{m.legends_editor_from_other_font()}
									</button>
								{/snippet}
								{#snippet inner(close)}
									<div class="flex w-80 max-w-full flex-col gap-3">
										<label class="label">
											<span class="label-text">{m.legends_create_font()}</span>
											<input
												class="input"
												type="file"
												accept=".ttf,.otf,font/ttf,font/otf"
												onchange={onAdhocFile}
											/>
										</label>
										<label class="label">
											<span class="label-text">{m.legends_editor_characters()}</span>
											<input class="input" type="text" bind:value={adhocText} />
										</label>
										<button
											class="btn preset-filled-primary-500"
											disabled={!adhocBuffer || !adhocText}
											onclick={() => applyAdhoc(close)}
										>
											{m.legends_editor_apply()}
										</button>
									</div>
								{/snippet}
							</Modal>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
</Layout>
