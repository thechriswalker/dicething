<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import Logo from '../icons/Logo.svelte';
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import LightSwitch from '../light_switch/LightSwitch.svelte';
	import { getMenuItems } from './AppBarMenu.svelte';
	import Menu from '../menu/Menu.svelte';
	/*
		Menu?

		File:
			New Dice Set > (presets)
			Load Dice Set > (list local sets) < disable if no sets
			Import JSON
			Export JSON < disable if no set loaded
			---
			Export STL < disable if no set loaded
	*/
	let menuData = getMenuItems();
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
	<Menu  data={menuData} />
</AppBar>
