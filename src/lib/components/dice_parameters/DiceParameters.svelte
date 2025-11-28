<script lang="ts">
	import dice from '$lib/dice';
	import type { Dice } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { engravingParam, type Builder } from '$lib/utils/builder';
	import { debugLegendName, Legend, type LegendSet } from '$lib/utils/legends';
	import { Vector2 } from 'three';
	import { degToRad, radToDeg } from 'three/src/math/MathUtils.js';
	import { Slider } from '@skeletonlabs/skeleton-svelte';

	type Props = {
		kind: Dice['kind'];
		dparams: Dice['parameters'];
		fparams: Dice['face_parameters'];
		legends: LegendSet;
		selectedFace: number;
		builder: Builder;
		onChangeSelectedFace?: (n: number) => void;
	};

	let {
		legends,
		kind,
		dparams = $bindable(),
		fparams = $bindable(),
		selectedFace = $bindable(),
		builder,
		onChangeSelectedFace
	}: Props = $props();

	const faces = builder.getFaces();
	const firstBlank = faces.findIndex((x) => !x.isNumberFace);
	const model = dice[kind];
	const params = model.parameters;
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

	// using "object entries" here means any change to the object will trigger an upate
	let vol = $derived(Object.values(dparams) ? builder.getApproximateVolume() : '-');
	let f2f = $derived(Object.values(dparams) ? builder.getFace2FaceDistance() : '-');
</script>

<div class="card preset-tonal-surface w-72 p-4">
	<p class="preset-typo-subtitle text-center">{m['dice.name']({ kind })}</p>
	<p>
		Approximate Volume: {numberFormat(vol)}
	</p>
	<p>
		{m['dice_parameters.face_to_face_distance']()}: {numberFormat(f2f)}
	</p>
	{#each params as p}
		{@const currentValue = dparams[p.id] ?? p.defaultValue}
		<label
			id="parameter-{p.id}"
			class="flex flex-col"
			title={m['dice_parameters.description']({ id: p.id })}
		>
			{m['dice_parameters.name']({ id: p.id })}: ({currentValue}):
			<!-- Bits UI Slider component! -->

			<Slider
				classes="py-2 my-2 "
				meterBg="bg-primary-500"
				thumbBg="bg-primary-500"
				value={[currentValue]}
				onValueChange={(e) => (dparams[p.id] = e.value[0])}
				min={p.min}
				max={p.max}
				step={p.step}
			></Slider>
		</label>
	{/each}
	<label
		id="parameter-{engravingParam.id}"
		class="flex flex-col"
		title={m['dice_parameters.description']({ id: engravingParam.id })}
	>
		{m['dice_parameters.name']({ id: engravingParam.id })}: ({dparams[engravingParam.id] ??
			engravingParam.defaultValue}):
		<!-- Bits UI Slider component! -->

		<Slider
			classes="py-2 my-2 "
			meterBg="bg-primary-500"
			thumbBg="bg-primary-500"
			value={[dparams[engravingParam.id] ?? engravingParam.defaultValue]}
			onValueChange={(e) => (dparams[engravingParam.id] = e.value[0])}
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
						selected={l === (fparams[selectedFace]?.legend ?? faces[selectedFace]?.defaultLegend)}
						>{debugLegendName(l)}</option
					>
				{/each}
			</select>
		</label>
		<label class="flex flex-col"
			>scale ({fparams[selectedFace]?.scale ?? builder?.currentLegendScaling ?? 1})
			<Slider
				classes="py-2 my-2 "
				meterBg="bg-primary-500"
				thumbBg="bg-primary-500"
				value={[fparams[selectedFace]?.scale ?? builder?.currentLegendScaling ?? 1]}
				onValueChange={(e) => {
					const nextScale = e.value[0];
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
			>offset-x ({(fparams[selectedFace]?.offset ?? new Vector2(0, 0)).x.toFixed(2)})
			<Slider
				classes="py-2 my-2 "
				meterBg="bg-primary-500"
				thumbBg="bg-primary-500"
				value={[(fparams[selectedFace]?.offset ?? new Vector2(0, 0)).x]}
				onValueChange={(e) => {
					const nextOffset = e.value[0];
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
		>offset-y ({(fparams[selectedFace]?.offset ?? new Vector2(0, 0)).y.toFixed(2)})
		<Slider
			classes="py-2 my-2 "
			meterBg="bg-primary-500"
			thumbBg="bg-primary-500"
			value={[(fparams[selectedFace]?.offset ?? new Vector2(0, 0)).y]}
			onValueChange={(e) => {
				const nextOffset = e.value[0];
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
		>rotation ({radToDeg(fparams[selectedFace]?.rotation ?? 0).toFixed(2)})
		<Slider
			classes="py-2 my-2 "
			meterBg="bg-primary-500"
			thumbBg="bg-primary-500"
			value={[radToDeg(fparams[selectedFace]?.rotation ?? 0)]}
			onValueChange={(e) => {
				const nextOffset = e.value[0];
				const params = fparams[selectedFace] ?? {};
				params.rotation = degToRad(nextOffset);
				fparams[selectedFace] = params;
			}}
			min={-180}
			max={180}
			step={0.1}
		></Slider>
	</label>
</div>
