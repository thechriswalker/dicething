<script lang="ts">
	import dice from '$lib/dice';
	import type { Dice } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { engravingParam, type Builder } from '$lib/utils/builder';
	import { type LegendSet } from '$lib/utils/legends';
	import { Vector2 } from 'three';
	import { degToRad, radToDeg } from 'three/src/math/MathUtils.js';
	import Slider from '$lib/components/slider/Slider.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import LegendViewer from '../legend_viewer/LegendViewer.svelte';
	import LegendPreview from '../legend_viewer/LegendPreview.svelte';
	import Collapsible from '../collapsible/Collapsible.svelte';

	type Props = {
		kind: Dice['kind'];
		dparams: Dice['parameters'];
		fparams: Dice['face_parameters'];
		legends: LegendSet;
		selectedFace: number;
		builder: Builder;
		renderPass: number;
		onChangeSelectedFace?: (n: number) => void;
	};

	let {
		legends,
		kind,
		dparams = $bindable(),
		fparams = $bindable(),
		selectedFace = $bindable(),
		builder,
		renderPass,
		onChangeSelectedFace
	}: Props = $props();

	let model = $derived(dice[kind]);
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
	let vol = $derived(renderPass ? builder.getApproximateVolume() : '-');
	let f2f = $derived(renderPass ? builder.getFace2FaceDistance() : '-');
	let firstBlank = $derived(faces.findIndex((x) => !x.isNumberFace));
	let engravingDepth = $derived(dparams[engravingParam.id] ?? engravingParam.defaultValue);
	let faceLegend = $derived(fparams[selectedFace]?.legend ?? faces[selectedFace]?.defaultLegend);
	let faceLegendScale = $derived(
		fparams[selectedFace]?.scale ?? builder.getDefaultScaleForLegend(faceLegend)
	);
	let faceLegendOffset = $derived(fparams[selectedFace]?.offset ?? new Vector2(0, 0));
	let faceRotationDegrees = $derived(radToDeg(fparams[selectedFace]?.rotation ?? 0));
</script>

<div class="card preset-tonal-surface flex w-72 flex-col gap-2 p-4">
	<Collapsible title={m.dice_name({ kind })}>
		<p class="flex justify-between">
			<span>{m.dice_parameters_approx_volume()}:</span> <span>{numberFormat(vol)}</span>
		</p>
		<p class="flex justify-between">
			<span>{m.dice_parameters_face_to_face_distance()}:</span> <span>{numberFormat(f2f)}</span>
		</p>
		{#each model.parameters as p}
			{@const currentValue = dparams[p.id] ?? p.defaultValue}
			<label
				id="parameter-{p.id}"
				class="flex flex-col"
				title={m.dice_parameters_description({ id: p.id })}
			>
				<p class="flex justify-between">
					<span>{m.dice_parameters_name({ id: p.id })}:</span> <span>({currentValue})</span>
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
		{/each}
		<label
			id="parameter-{engravingParam.id}"
			class="flex flex-col"
			title={m.dice_parameters_description({ id: engravingParam.id })}
		>
			<p class="flex justify-between">
				<span>
					{m.dice_parameters_name({ id: engravingParam.id })}:
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
	<Collapsible title={m.dice_current_face()}>
		<label class="mt-4 flex flex-col">
			<select
				class="select"
				onchange={(e) => {
					selectedFace = Number((e.target as any).value);
					onChangeSelectedFace?.(selectedFace);
				}}
			>
				<option value={-1}>-</option>
				{#each faces as face, i}
					{#if face.isNumberFace}
						<option value={i} selected={i === selectedFace}
							>{m.face_parameters_face_name_0_n({ n: i + 1 })}</option
						>
					{:else}
						<option value={i} selected={i === selectedFace}
							>{m.face_parameters_blank_name_0_n({ n: i + 1 - firstBlank })}</option
						>
					{/if}
				{/each}
			</select>
		</label>
		{#if selectedFace !== -1}
			<!-- 
	face params are specific:
	
	legend
	scale: 0-2
	rotation: -Pi - Pi
	extraDepth: 0-1 // for engraving
	offset Vector2 (i.e. x,y) from center. might be better to have a component for this
	that we bind to the faceparams
	
	-->
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
						<LegendViewer
							{legends}
							selectedLegend={faceLegend}
							onSelectedLegend={(next) => {
								const _params = fparams[selectedFace] ?? {};
								_params.legend = next;
								fparams[selectedFace] = _params;
								close();
							}}
						/>
					{/snippet}
				</Modal>
			</label>
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
						const _params = fparams[selectedFace] ?? {};
						_params.scale = nextScale;
						fparams[selectedFace] = _params;
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
						const _params = fparams[selectedFace] ?? {};
						if (_params.offset) {
							_params.offset = _params.offset.clone().setX(nextOffset);
						} else {
							_params.offset = new Vector2(nextOffset, 0);
						}
						fparams[selectedFace] = _params;
					}}
					min={-20}
					max={20}
					step={0.1}
				></Slider>
			</label>
		{/if}
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
					const _params = fparams[selectedFace] ?? {};
					if (_params.offset) {
						_params.offset = _params.offset.clone().setY(nextOffset);
					} else {
						_params.offset = new Vector2(0, nextOffset);
					}
					fparams[selectedFace] = _params;
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
					const params = fparams[selectedFace] ?? {};
					params.rotation = degToRad(nextRotation);
					fparams[selectedFace] = params;
				}}
				min={-180}
				max={180}
				step={0.1}
			></Slider>
		</label>
	</Collapsible>
</div>
