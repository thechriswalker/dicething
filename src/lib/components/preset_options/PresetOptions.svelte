<script lang="ts">
	import builtins, { blanks } from '$lib/fonts';
	import type { PresetOption } from '$lib/interfaces/presets';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import Slider from '../slider/Slider.svelte';
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { getSavedLegends } from '$lib/interfaces/storage.svelte';
	import { legendSetPreview } from '$lib/utils/create_legends';
	import DiePreview from '../die_preview/DiePreview.svelte';
	import type { Dice } from '$lib/interfaces/storage.svelte';

	// a blank die used purely to render a shape preview thumbnail.
	const previewDie = (kind: string): Dice => ({
		id: 'preset-preview:' + kind,
		kind: kind as Dice['kind'],
		parameters: {},
		face_parameters: []
	});

	const savedLegends = getSavedLegends();

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

<div class="flex min-w-200 flex-col gap-4">
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
		{#if opt.kind == 'die'}
			<p class="h5">{m.preset_options_select_title({ id: opt.id })}</p>
			<div class="grid grid-flow-col gap-4">
				{#each opt.options as kind}
					{@const border =
						kind == (values[idx] ?? opt.value)
							? 'preset-filled-primary-500 preset-outlined-primary-500'
							: 'preset-filled-surface-50-950 preset-outlined hover:preset-outlined-primary-500'}
					<button
						class={'flex flex-col items-center justify-between gap-2 rounded-md p-2 ' + border}
						onclick={() => {
							values[idx] = kind;
						}}
					>
						<DiePreview class="max-w-18" die={previewDie(kind)} legends={blanks} />
						<strong>{m.dice_name({ kind })}</strong>
					</button>
				{/each}
			</div>
		{/if}
		{#if opt.kind == 'legend'}
			{@const builtinList = Object.values(builtins).filter((f) => f.id !== 'blanks')}
			<p class="h5">{m.preset_options_pick_legends()}</p>
			{#if savedLegends.length > 0}
				<p class="h6">{m.preset_options_custom()}</p>
				<div class="grid grid-cols-3 gap-4">
					{#each savedLegends as set}
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
							<div class="flex h-[24px] items-center justify-center">
								<img
									src={legendSetPreview(set)}
									alt={m.preset_options_font_preview()}
									class="max-h-[24px] dark:invert"
								/>
							</div>
						</button>
					{/each}
				</div>
				<hr class="hr" />
			{/if}
			<p class="h6">{m.preset_options_builtin()}</p>
			<div class="grid grid-cols-3 gap-4">
				{#each builtinList as f}
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
						<div class="flex h-[24px] items-center justify-center">
							<img
								src={f.preview}
								alt={m.preset_options_font_preview()}
								class="max-h-[24px] dark:invert"
							/>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/each}
	<button class="btn preset-filled-primary-500 w-full" onclick={submit}
		>{m.preset_options_submit()}</button
	>
</div>
