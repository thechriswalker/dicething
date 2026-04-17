<script lang="ts">
	import builtins from '$lib/fonts';
	import type { PresetOption } from '$lib/interfaces/presets';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import Slider from '../slider/Slider.svelte';
	import { onMount } from 'svelte';

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
	<p class="h5">$$SET_NAME$$</p>
	<input
		type="text"
		class="input"
		placeholder={'$$SET_NAME_PLACEHOLDER$$'}
		bind:value={localName}
	/>
	{#each options as opt, idx}
		{#if opt.kind == 'bool'}
			<p class="h5">$BOOLEAN_OPTION_{opt.id}$</p>
			<Switch
				class="items-end justify-center"
				defaultChecked={values[idx] ?? opt.value}
				onCheckedChange={(d) => {
					values[idx] = d.checked;
				}}
			>
				<Switch.Label>$BOOLEAN_OPTION{opt.id}_DISABLED$</Switch.Label>

				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.Label>$BOOLEAN_OPTION{opt.id}_ENABLED$</Switch.Label>
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
			<p class="h5">$SELECT_OPTION_{opt.id}$</p>
			<select class="select" onchange={(e) => (values[idx] = e.currentTarget.value)}>
				{#each opt.options as entry}
					<option value={entry[0]} selected={entry[0] === (values[idx] ?? opt.value)}>
						{entry[1]}
					</option>
				{/each}
			</select>
		{/if}
		{#if opt.kind == 'legend'}
			<p class="h5">$PICK_YOUR_LEGENDS$</p>
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
							<img height="10px" src={f.preview} alt="$FONT_PREVIEW$" class="dark:invert" />
						</button>
					{/if}
				{/each}
			</div>
		{/if}
	{/each}
	<button onclick={submit}>$SUBMIT</button>
</div>
