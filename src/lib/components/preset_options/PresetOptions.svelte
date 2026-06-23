<script lang="ts">
	import builtins from '$lib/fonts';
	import type { PresetOption } from '$lib/interfaces/presets';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import Slider from '../slider/Slider.svelte';
	import LegendPreview from '../legend_viewer/LegendPreview.svelte';
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { getSavedLegends } from '$lib/interfaces/storage.svelte';
	import { Legend } from '$lib/utils/legends';

	const savedLegends = getSavedLegends();
	const previewLegends = [Legend.ONE, Legend.TWO, Legend.THREE, Legend.TWENTY];

	let {
		options,
		onSubmit,
		description,
		name
	}: {
		description: string;
		name: string;
		options: Array<PresetOption>;
		onSubmit?: (name: string, o: Array<PresetOption>) => void;
	} = $props();

	let values = $state<Array<any>>([]);
	let localName = $state<string>('');
	onMount(() => {
		values = []; // reset values.
		localName = name;
	});

	function submit() {
		const selected: Array<PresetOption> = options.map((v, i) => {
			const o = { ...v };
			if (values[i] !== undefined) {
				o.value = values[i];
			}
			return o;
		});
		onSubmit?.(localName, selected);
	}
</script>

<div class="flex flex-col gap-4">
	<div class="text-lg">{description}</div>
	<p class="h5">{m.preset_options_set_name()}</p>
	<input
		type="text"
		class="input"
		placeholder={m.preset_options_set_name_placeholder()}
		bind:value={localName}
	/>
	{#each options as opt, idx}
		{#if opt.kind == 'bool'}
			<p class="h5">{m.preset_options_bool_title({ id: opt.id })}</p>
			<Switch
				class="items-end justify-center"
				defaultChecked={values[idx] ?? opt.value}
				onCheckedChange={(d) => {
					values[idx] = d.checked;
				}}
			>
				<Switch.Label>{m.preset_options_bool_disabled({ id: opt.id })}</Switch.Label>

				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.Label>{m.preset_options_bool_enabled({ id: opt.id })}</Switch.Label>
				<Switch.HiddenInput />
			</Switch>
		{/if}
		{#if opt.kind == 'range'}
			<Slider
				class="py-1"
				value={values[idx] ?? opt.value}
				onChange={(e) => (values[idx] = e)}
				min={opt.min}
				max={opt.max}
				step={opt.step}
			></Slider>
		{/if}
		{#if opt.kind == 'select'}
			<p class="h5">{m.preset_options_select_title({ id: opt.id })}</p>
			<select class="select" onchange={(e) => (values[idx] = e.currentTarget.value)}>
				{#each opt.options as entry}
					<option value={entry[0]} selected={entry[0] === (values[idx] ?? opt.value)}>
						{entry[1]}
					</option>
				{/each}
			</select>
		{/if}
		{#if opt.kind == 'legend'}
			<p class="h5">{m.preset_options_pick_legends()}</p>
			<div class="grid grid-cols-3 gap-4">
				{#each Object.values(builtins) as f}
					{#if f.tags.includes(opt.filter)}
						{@const border =
							f.id == (values[idx] ?? opt.value)
								? 'preset-filled-primary-500 preset-outlined-primary-500'
								: 'preset-filled-surface-50-950 preset-outlined hover:preset-outlined-primary-500'}
						<button
							class={'flex flex-col justify-between gap-2 rounded-md p-2  ' + border}
							onclick={() => {
								values[idx] = f.id;
							}}
						>
							<strong>{f.name}</strong>
							<img height="10px" src={f.preview} alt={m.preset_options_font_preview()} class="dark:invert" />
						</button>
					{/if}
				{/each}
				{#each savedLegends as set}
					{#if set.tags.includes(opt.filter)}
						{@const border =
							set.id == (values[idx] ?? opt.value)
								? 'preset-filled-primary-500 preset-outlined-primary-500'
								: 'preset-filled-surface-50-950 preset-outlined hover:preset-outlined-primary-500'}
						<button
							class={'flex flex-col justify-between gap-2 rounded-md p-2  ' + border}
							onclick={() => {
								values[idx] = set.id;
							}}
						>
							<strong>{set.name}</strong>
							<div class="flex flex-row flex-wrap gap-1">
								{#each previewLegends as l}
									<LegendPreview legends={set} legend={l} class="size-6" />
								{/each}
							</div>
						</button>
					{/if}
				{/each}
			</div>
		{/if}
	{/each}
	<button class="btn preset-filled-primary-500 w-full" onclick={submit}
		>{m.preset_options_submit()}</button
	>
</div>
