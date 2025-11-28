<script lang="ts">
	import dice from '$lib/dice';
	import type { Dice } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { engravingParam, type Builder } from '$lib/utils/builder';
	import { debugLegendName, Legend, type LegendSet } from '$lib/utils/legends';
	import { Vector2 } from 'three';
	import { degToRad, radToDeg } from 'three/src/math/MathUtils.js';
	import Slider from '$lib/components/slider/Slider.svelte';
	import type { DieFaceModel } from '$lib/interfaces/dice';

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
	let vol = $derived(renderPass ? builder.getApproximateVolume() : "-");
	let f2f = $derived(renderPass ? builder.getFace2FaceDistance() : "-")
	let firstBlank = $derived(faces.findIndex((x) => !x.isNumberFace));
	let engravingDepth = $derived(dparams[engravingParam.id] ?? engravingParam.defaultValue);
	let faceLegend = $derived(fparams[selectedFace]?.legend ?? faces[selectedFace]?.defaultLegend);
	let faceLegendScale = $derived(fparams[selectedFace]?.scale ?? builder.getDefaultScaleForLegend(faceLegend));
	let faceLegendOffset = $derived(fparams[selectedFace]?.offset ?? new Vector2(0, 0));
	let faceRotationDegrees = $derived(radToDeg(fparams[selectedFace]?.rotation ?? 0));
</script>

<div class="card preset-tonal-surface w-72 p-4">
	<p class="preset-typo-subtitle text-center">{m['dice.name']({ kind })}</p>
	<p>
		Approximate Volume: {numberFormat(vol)}
	</p>
	<p>
		{m['dice_parameters.face_to_face_distance']()}: {numberFormat(f2f)}
	</p>
	{#each model.parameters as p}
		{@const currentValue = dparams[p.id] ?? p.defaultValue}
		<label
			id="parameter-{p.id}"
			class="flex flex-col"
			title={m['dice_parameters.description']({ id: p.id })}
		>
			{m['dice_parameters.name']({ id: p.id })}: ({currentValue}):
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
		title={m['dice_parameters.description']({ id: engravingParam.id })}
	>
		{m['dice_parameters.name']({ id: engravingParam.id })}: ({engravingDepth}):
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
	<label class="mt-4 flex flex-col">
		<p class="preset-typo-subtitle text-center">{m['dice.current_face']()}</p>
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
					<option value={i} selected={i === selectedFace}>Face {i + 1}</option>
				{:else}
					<option value={i} selected={i === selectedFace}>Blank {i + 1 - firstBlank}</option>
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
		<label class="flex flex-col">
			<!-- >{
									//m['face_params.legend']()
									} -->
			Legend
			<select
				onchange={(e) => {
					//
					const nextLegend = (e.target as any).value as Legend;
					const _params = fparams[selectedFace] ?? {};
					_params.legend = nextLegend;
					fparams[selectedFace] = _params;
				}}
			>
				<!-- @TODO - replace this with a custom component with pictures, rather than dumb names -->
				<option value={Legend.BLANK}>BLANK</option>
				{#each legends as l}
					<option
						value={l}
						selected={l === (faceLegend)}
						>{debugLegendName(l)}</option
					>
				{/each}
			</select>
		</label>
		<label class="flex flex-col"
			>scale ({numberFormat(faceLegendScale)})
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
		<label class="flex flex-col"
			>offset-x ({faceLegendOffset.x.toFixed(2)})
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
	<label class="flex flex-col"
		>offset-y ({faceLegendOffset.y.toFixed(2)})
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
	<label class="flex flex-col"
		>rotation ({faceRotationDegrees.toFixed(2)})
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
</div>
