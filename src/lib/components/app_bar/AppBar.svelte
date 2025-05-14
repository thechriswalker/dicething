<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import Logo from '../icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import LightSwitch from '../light_switch/LightSwitch.svelte';
	import Menu from '../menu/Menu.svelte';
	/*
		Menu?

		I wanted to be able to set this from a child, via context... but I couldn't get it to
		work reactively

		File:
			New Dice Set > (presets)
			Load Dice Set > (list local sets) < disable if no sets
			Import JSON
			Export JSON < disable if no set loaded
			---
			Export STL < disable if no set loaded
	*/
</script>

<AppBar>
	{#snippet lead()}
		<div class="flex flex-row items-center justify-start gap-2">
			<a href="/"><Logo /></a>
			<h1 class="h4">{m['meta.app_name']()}</h1>
		</div>
	{/snippet}
	{#snippet trail()}
		<LightSwitch />
	{/snippet}
	<Menu data={{}} />
</AppBar>
