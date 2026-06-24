<script lang="ts">
	import dice from '$lib/dice';
	import type { Dice } from '$lib/interfaces/storage.svelte';
	import type { FaceParams } from '$lib/interfaces/dice';
	import { isBuiltin } from '$lib/fonts';
	import { m } from '$lib/paraglide/messages';
	import { engravingParam, type Builder } from '$lib/utils/builder';
	import { type LegendSet } from '$lib/utils/legends';
	import { Vector2 } from 'three';
	import { degToRad, radToDeg } from 'three/src/math/MathUtils.js';
	import { InfoIcon, PencilIcon } from '@lucide/svelte';
	import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import Slider from '$lib/components/slider/Slider.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import LegendViewer from '../legend_viewer/LegendViewer.svelte';
	import LegendPreview from '../legend_viewer/LegendPreview.svelte';
	import Collapsible from '../collapsible/Collapsible.svelte';
	import CollapsibleGroup from '../collapsible/CollapsibleGroup.svelte';

	type SelectMode = 'single' | 'multi' | 'none';

	type Props = {
		kind: Dice['kind'];
		dparams: Dice['parameters'];
		sparams: Record<string, string> | undefined;
		fparams: Dice['face_parameters'];
		legends: LegendSet;
		selectMode: SelectMode;
		selectedFace: number;
		selectedFaces: number[];
		builder: Builder;
		renderPass: number;
		onChangeSelectedFace?: (n: number) => void;
		onApplyToAll?: () => void;
		onEnterFormatPaint?: () => void;
		onSyncFaces?: () => void;
		onEditLegends?: () => void;
	};

	let {
		legends,
		kind,
		dparams = $bindable(),
		sparams = $bindable(),
		fparams = $bindable(),
		selectMode = $bindable(),
		selectedFace = $bindable(),
		selectedFaces = $bindable(),
		builder,
		renderPass,
		onChangeSelectedFace,
		onApplyToAll,
		onEnterFormatPaint,
		onSyncFaces,
		onEditLegends
	}: Props = $props();

	let model = $derived(dice[kind]);

	// a parameter (numeric or string) may be gated on another numeric parameter's
	// current value (e.g. show "Rim Segments" only in polygon mode).
	function paramVisible(visibleWhen?: { param: string; equals: number }): boolean {
		if (!visibleWhen) {
			return true;
		}
		const current =
			dparams[visibleWhen.param] ??
			model.parameters.find((p) => p.id === visibleWhen.param)?.defaultValue;
		return Math.round(Number(current)) === visibleWhen.equals;
	}

	// the string-parameter channel is optional on a die; initialize it lazily on
	// first write so the value can be persisted (and bound back to the parent).
	function setStringParam(id: string, value: string) {
		if (!sparams) {
			sparams = {};
		}
		sparams[id] = value;
	}
	const nf = Intl.NumberFormat(undefined, {
		maximumFractionDigits: 2,
		trailingZeroDisplay: 'stripIfInteger'
	});
	function numberFormat(x: string | number): string {
		if (typeof x === 'string') {
			return x;
		}
		return nf.format(x);
	}
	let faces = $derived(renderPass ? builder.getFaces() : []);
	// faces that the user can actually see/edit. `hidden` faces (e.g. the coin's
	// rim segments) are built and exported but never listed or selectable.
	let visibleFaces = $derived(
		faces.map((face, i) => ({ face, i })).filter(({ face }) => !face.hidden)
	);
	// 1 ml = 1 cm³ = 1000 mm³, and we treat the three.js unit as a mm.
	let vol = $derived(renderPass ? builder.getApproximateVolume() / 1000 : '-');
	let f2f = $derived(renderPass ? builder.getFace2FaceDistance() : '-');
	let firstBlank = $derived(faces.findIndex((x) => !x.isNumberFace));
	let engravingDepth = $derived(dparams[engravingParam.id] ?? engravingParam.defaultValue);

	function faceName(face: { isNumberFace: boolean }, i: number): string {
		return face.isNumberFace
			? m.face_parameters_face_name_0_n({ n: i + 1 })
			: m.face_parameters_blank_name_0_n({ n: i + 1 - firstBlank });
	}

	// the faces that edits apply to. in multi mode this is every selected face;
	// in single mode it's just the selected one; in none mode it's empty.
	let targetFaces = $derived.by(() => {
		if (selectMode === 'multi') return selectedFaces;
		if (selectMode === 'single' && selectedFace >= 0) return [selectedFace];
		return [];
	});
	// the face whose values are shown on the sliders. for multi we show the first.
	let displayFace = $derived(targetFaces.length > 0 ? targetFaces[0] : -1);

	// the current value of the face <select>. driving the select's `value`
	// directly (rather than per-option `selected` attributes) keeps it in sync
	// when the selection is changed programmatically, e.g. by clicking a face in
	// the 3D view. values are strings so face indices and the 'none'/'multi'
	// modes can share one control.
	let faceSelectValue = $derived(selectMode === 'single' ? String(selectedFace) : selectMode);

	// apply a mutation to the FaceParams of every currently targeted face.
	function updateTargetFaces(mutate: (params: FaceParams) => void) {
		for (const i of targetFaces) {
			const params = fparams[i] ?? {};
			mutate(params);
			fparams[i] = params;
		}
	}

	let faceLegend = $derived(fparams[displayFace]?.legend ?? faces[displayFace]?.defaultLegend);
	let faceLegendScale = $derived(
		fparams[displayFace]?.scale ?? builder.getDefaultScaleForLegend(faceLegend)
	);
	let faceLegendOffset = $derived(fparams[displayFace]?.offset ?? new Vector2(0, 0));
	let faceRotationDegrees = $derived(radToDeg(fparams[displayFace]?.rotation ?? 0));
</script>

<!-- a small "i" affordance that reveals help text on hover/focus. -->
{#snippet helpIcon(text: string)}
	<Tooltip content={text} side="left">
		{#snippet children(props)}
			<button
				{...props}
				type="button"
				class="text-surface-500 hover:text-primary-500 inline-flex items-center"
				aria-label={text}
				onclick={(e) => e.preventDefault()}
			>
				<InfoIcon class="size-3.5" />
			</button>
		{/snippet}
	</Tooltip>
{/snippet}

<div class="card preset-tonal-surface flex w-72 flex-col gap-2 p-4">
	<CollapsibleGroup defaultValue="dice">
		<Collapsible value="dice" title={m.dice_name({ kind })} defaultOpen={false}>
			<p class="flex justify-between">
				<span>{m.dice_parameters_approx_volume()}:</span>
				<span>{numberFormat(vol)}{typeof vol === 'number' ? ' ml' : ''}</span>
			</p>
			<p class="flex justify-between">
				<span>{m.dice_parameters_face_to_face_distance()}:</span> <span>{numberFormat(f2f)}</span>
			</p>
			{#each model.parameters as p}
				{@const currentValue = dparams[p.id] ?? p.defaultValue}
				{#if paramVisible(p.visibleWhen)}
					{#if p.display?.kind === 'toggle'}
						<div id="parameter-{p.id}" class="flex flex-col gap-1">
							<p class="flex items-center justify-between">
								<span class="flex items-center gap-1">
									{m.dice_parameters_name({ id: p.id })}:
									{@render helpIcon(m.dice_parameters_description({ id: p.id }))}
								</span>
							</p>
							<SegmentedControl
								value={String(currentValue)}
								onValueChange={(e) => {
									if (e.value != null) dparams[p.id] = Number(e.value);
								}}
							>
								<SegmentedControl.Control>
									<SegmentedControl.Indicator class="bg-primary-500" />
									{#each p.display.options as opt}
										<SegmentedControl.Item value={String(opt.value)}>
											<SegmentedControl.ItemText
												class="data-[state=checked]:text-primary-contrast-500"
											>
												{m.dice_parameter_option({ key: opt.label })}
											</SegmentedControl.ItemText>
											<SegmentedControl.ItemHiddenInput />
										</SegmentedControl.Item>
									{/each}
								</SegmentedControl.Control>
							</SegmentedControl>
						</div>
					{:else}
						<label id="parameter-{p.id}" class="flex flex-col">
							<p class="flex items-center justify-between">
								<span class="flex items-center gap-1">
									{m.dice_parameters_name({ id: p.id })}:
									{@render helpIcon(m.dice_parameters_description({ id: p.id }))}
								</span>
								<span>({currentValue})</span>
							</p>
							<!-- Bits UI Slider component! -->

							<Slider
								class="py-1"
								value={currentValue}
								onChange={(newValue) => (dparams[p.id] = newValue)}
								min={p.min}
								max={p.max}
								step={p.step}
							/>
						</label>
					{/if}
				{/if}
			{/each}
			{#each model.stringParameters ?? [] as p}
				{#if paramVisible(p.visibleWhen)}
					{@const value = sparams?.[p.id] ?? p.defaultValue}
					{@const validation = p.validate?.(value)}
					<label id="parameter-{p.id}" class="flex flex-col">
						<p class="flex items-center justify-between">
							<span class="flex items-center gap-1">
								{m.dice_parameters_name({ id: p.id })}:
								{@render helpIcon(m.dice_parameters_description({ id: p.id }))}
							</span>
						</p>
						<textarea
							class="textarea {validation && !validation.valid ? 'border-error-500' : ''}"
							rows="3"
							spellcheck="false"
							{value}
							oninput={(e) => setStringParam(p.id, (e.target as HTMLTextAreaElement).value)}
						></textarea>
						{#if validation && !validation.valid && validation.error}
							<span class="text-error-500 mt-1 text-sm">
								{m.dice_parameter_message({ key: validation.error })}
							</span>
						{:else if validation && validation.warning}
							<span class="text-warning-500 mt-1 text-sm">
								{m.dice_parameter_message({ key: validation.warning })}
							</span>
						{/if}
					</label>
				{/if}
			{/each}
			<label id="parameter-{engravingParam.id}" class="flex flex-col">
				<p class="flex items-center justify-between">
					<span class="flex items-center gap-1">
						{m.dice_parameters_name({ id: engravingParam.id })}:
						{@render helpIcon(m.dice_parameters_description({ id: engravingParam.id }))}
					</span>
					<span>
						({engravingDepth})
					</span>
				</p>
				<!-- Bits UI Slider component! -->

				<Slider
					class="py-1"
					value={engravingDepth}
					onChange={(e) => (dparams[engravingParam.id] = e)}
					min={engravingParam.min}
					max={engravingParam.max}
					step={engravingParam.step}
				></Slider>
			</label>
		</Collapsible>
		<Collapsible value="face" title={m.dice_current_face()} defaultOpen={false}>
			<label class="mt-4 flex flex-col">
				<select
					class="select"
					value={faceSelectValue}
					onchange={(e) => {
						const v = (e.target as HTMLSelectElement).value;
						if (v === 'none') {
							selectMode = 'none';
							selectedFaces = [];
						} else if (v === 'multi') {
							// seed the multi selection with the current single face, if any.
							if (selectMode !== 'multi') {
								selectedFaces = selectMode === 'single' && selectedFace >= 0 ? [selectedFace] : [];
							}
							selectMode = 'multi';
						} else {
							selectMode = 'single';
							selectedFaces = [];
							selectedFace = Number(v);
							onChangeSelectedFace?.(selectedFace);
						}
					}}
				>
					<option value="none">{m.face_select_none()}</option>
					<option value="multi">{m.face_select_multi()}</option>
					{#each visibleFaces as { face, i } (i)}
						<option value={String(i)}>{faceName(face, i)}</option>
					{/each}
				</select>
			</label>
			{#if selectMode === 'multi'}
				<div class="mt-2 flex items-center justify-end gap-2 text-sm">
					<button
						type="button"
						class="anchor"
						onclick={() => {
							selectedFaces = visibleFaces.map(({ i }) => i);
						}}>{m.face_select_all()}</button
					>
					<span>/</span>
					<button
						type="button"
						class="anchor"
						onclick={() => {
							selectedFaces = [];
						}}>{m.face_select_clear()}</button
					>
				</div>
				<div class="border-surface-300-700 mt-1 max-h-32 overflow-y-auto rounded border">
					{#each visibleFaces as { face, i } (i)}
						<label class="hover:bg-surface-200-800 flex items-center gap-2 px-2 py-1">
							<input
								type="checkbox"
								class="checkbox"
								checked={selectedFaces.includes(i)}
								onchange={(e) => {
									const checked = (e.target as HTMLInputElement).checked;
									const set = new Set(selectedFaces);
									if (checked) {
										set.add(i);
										selectedFace = i;
										onChangeSelectedFace?.(i);
									} else {
										set.delete(i);
									}
									// staying in multi mode even when 0 or 1 remain selected.
									selectedFaces = [...set].sort((a, b) => a - b);
								}}
							/>
							<span>{faceName(face, i)}</span>
						</label>
					{/each}
				</div>
			{/if}
			{#if targetFaces.length > 0}
				<!-- 
	face params are specific:
	
	legend
	scale: 0-2
	rotation: -Pi - Pi
	extraDepth: 0-1 // for engraving
	offset Vector2 (i.e. x,y) from center. might be better to have a component for this
	that we bind to the faceparams
	
	-->
				{#if selectMode === 'multi'}
					<button
						type="button"
						class="btn preset-tonal-primary my-2 w-full justify-start"
						onclick={() => onSyncFaces?.()}>{m.face_parameters_sync()}</button
					>
				{:else}
					<label class="my-2 flex items-center justify-between">
						<!-- >{
			//m['face_params.legend']()
			} -->
						{m.face_parameters_selected_legend()}
						<Modal>
							{#snippet title()}
								{m.face_parameters_pick_legend()}
							{/snippet}
							{#snippet trigger(props)}
								<button {...props} class="btn preset-filled-primary-500 p-0">
									<LegendPreview {legends} legend={faceLegend} class="size-12" />
								</button>
							{/snippet}
							{#snippet inner(close)}
								{#if onEditLegends}
									<div class="mb-2 flex justify-end">
										<button
											type="button"
											class="btn btn-sm preset-tonal-secondary"
											onclick={() => {
												close();
												onEditLegends?.();
											}}
										>
											<PencilIcon class="size-4" />
											{isBuiltin(legends.id)
												? m.legends_clone_builtin_edit()
												: m.legends_edit_legends()}
										</button>
									</div>
								{/if}
								<LegendViewer
									{legends}
									selectedLegend={faceLegend}
									onSelectedLegend={(next) => {
										updateTargetFaces((p) => (p.legend = next));
										close();
									}}
								/>
							{/snippet}
						</Modal>
					</label>
				{/if}
				<label class="flex flex-col">
					<p class="flex justify-between">
						<span>
							{m.face_parameters_scale()}
						</span>
						<span>
							({numberFormat(faceLegendScale)})
						</span>
					</p>

					<Slider
						class="py-1"
						value={faceLegendScale}
						onChange={(nextScale) => {
							updateTargetFaces((p) => (p.scale = nextScale));
						}}
						min={0.1}
						max={5.0}
						step={0.01}
					></Slider>
				</label>
				<label class="flex flex-col">
					<p class="flex justify-between">
						<span>
							{m.face_parameters_offset_x()}
						</span>
						<span>
							({faceLegendOffset.x.toFixed(2)})
						</span>
					</p>
					<Slider
						class="py-1"
						value={faceLegendOffset.x}
						onChange={(nextOffset) => {
							updateTargetFaces((p) => {
								p.offset = (p.offset?.clone() ?? new Vector2(0, 0)).setX(nextOffset);
							});
						}}
						min={-20}
						max={20}
						step={0.1}
					></Slider>
				</label>
				<label class="flex flex-col">
					<p class="flex justify-between">
						<span>
							{m.face_parameters_offset_y()}
						</span>
						<span>
							({faceLegendOffset.y.toFixed(2)})
						</span>
					</p>
					<Slider
						class="py-1"
						value={faceLegendOffset.y}
						onChange={(nextOffset) => {
							updateTargetFaces((p) => {
								p.offset = (p.offset?.clone() ?? new Vector2(0, 0)).setY(nextOffset);
							});
						}}
						min={-20}
						max={20}
						step={0.1}
					></Slider>
				</label>
				<label class="flex flex-col">
					<p class="flex justify-between">
						<span>
							{m.face_parameters_rotation()}
						</span>
						<span>
							({faceRotationDegrees.toFixed(2)})
						</span>
					</p>
					<Slider
						class="py-1"
						value={faceRotationDegrees}
						onChange={(nextRotation) => {
							updateTargetFaces((p) => (p.rotation = degToRad(nextRotation)));
						}}
						min={-180}
						max={180}
						step={0.1}
					></Slider>
				</label>
			{/if}
			{#if displayFace >= 0}
				<div class="mt-4 flex flex-col gap-2">
					<button
						type="button"
						class="btn preset-tonal-primary justify-start"
						onclick={() => onApplyToAll?.()}>{m.format_painter_apply_all()}</button
					>
					<button
						type="button"
						class="btn preset-tonal-primary justify-start"
						onclick={() => onEnterFormatPaint?.()}>{m.format_painter_enter()}</button
					>
				</div>
			{/if}
		</Collapsible>
	</CollapsibleGroup>
</div>
