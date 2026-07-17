<script lang="ts">
	import Modal from '$lib/components/modal/Modal.svelte';
	import Slider from '$lib/components/slider/Slider.svelte';
	import { m } from '$lib/paraglide/messages';
	import { engravingParam, engravingToleranceParam } from '$lib/utils/builder';
	import { SlidersHorizontal } from '@lucide/svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		depth,
		tolerance,
		depthMixed = false,
		toleranceMixed = false,
		onChangeDepth,
		onChangeTolerance,
		open = $bindable(false),
		showTrigger = true
	}: {
		depth: number;
		tolerance: number;
		depthMixed?: boolean;
		toleranceMixed?: boolean;
		onChangeDepth: (v: number) => void;
		onChangeTolerance: (v: number) => void;
		open?: boolean;
		showTrigger?: boolean;
	} = $props();
</script>

{#snippet title()}
	<div class="flex flex-row items-center justify-start gap-4 text-4xl">
		<SlidersHorizontal class="icon-text" />
		{m.set_config_title()}
	</div>
{/snippet}

{#snippet trigger(props: HTMLButtonAttributes)}
	<button {...props} class="btn preset-outlined-surface-500">
		<SlidersHorizontal class="icon-text" />
		{m.set_config_button()}
	</button>
{/snippet}

{#snippet inner()}
	<div class="flex w-[min(90vw,28rem)] flex-col gap-6">
		<section class="flex flex-col gap-4">
			<p class="text-surface-600-400 text-sm">{m.set_config_engraving_hint()}</p>

			<label class="flex flex-col gap-1">
				<p class="flex items-center justify-between">
					<span class="font-semibold">{m.set_config_engraving_depth()}</span>
					<span>({depth})</span>
				</p>
				<Slider
					class="py-1"
					value={depth}
					onChange={onChangeDepth}
					min={engravingParam.min}
					max={engravingParam.max}
					step={engravingParam.step}
				/>
			</label>

			<label class="flex flex-col gap-1">
				<p class="flex items-center justify-between">
					<span class="font-semibold">{m.set_config_engraving_tolerance()}</span>
					<span>({tolerance})</span>
				</p>
				<Slider
					class="py-1"
					value={tolerance}
					onChange={onChangeTolerance}
					min={engravingToleranceParam.min}
					max={engravingToleranceParam.max}
					step={engravingToleranceParam.step}
				/>
			</label>

			{#if depthMixed || toleranceMixed}
				<p class="text-warning-700-300 text-sm">{m.set_config_mixed_hint()}</p>
			{/if}
		</section>
	</div>
{/snippet}

<Modal bind:open {title} {inner} trigger={showTrigger ? trigger : undefined} />
