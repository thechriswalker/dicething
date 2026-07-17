<script lang="ts">
	import { Slider } from '@skeletonlabs/skeleton-svelte';
	import { onMount } from 'svelte';

	let {
		value,
		onChange,
		min,
		max,
		step,
		class: classes = ''
	}: {
		class?: string;
		min: number;
		max: number;
		step: number;
		value: number;
		onChange: (v: number) => void;
	} = $props();

	// Skeleton/Zag can emit onValueChange while syncing the controlled value on
	// mount. Ignore those so parents don't treat hydration as a user edit.
	let acceptChanges = false;
	onMount(() => {
		// defer past the initial controlled-value sync effects
		requestAnimationFrame(() => {
			acceptChanges = true;
		});
	});
</script>

<Slider
	value={[value]}
	onValueChange={(e) => {
		if (!acceptChanges) {
			return;
		}
		onChange(e.value[0]);
	}}
	{min}
	{max}
	{step}
	class={classes}
>
	<Slider.Control>
		<Slider.Track class="bg-primary-50-950">
			<Slider.Range class="bg-primary-500" />
		</Slider.Track>
		<Slider.Thumb
			index={0}
			class="ring-primary-500 data-[focus]:outline-primary-500 data-[focus]:outline-2 data-[focus]:outline-offset-2"
		>
			<Slider.HiddenInput />
		</Slider.Thumb>
	</Slider.Control>
</Slider>
