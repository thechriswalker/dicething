<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import Logo from '../icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import LightSwitch from '../light_switch/LightSwitch.svelte';
	import type { Snippet } from 'svelte';
	let { title, children }: { title: string; children?: Snippet } = $props();
</script>

<AppBar>
	<AppBar.Toolbar class="grid-cols-[auto_1fr_auto]">
		<AppBar.Lead class="flex flex-row items-center justify-start gap-2">
			<a href="/"><Logo /></a>
			<h1 class="h4">
				{m.meta_app_name()}
			</h1>
		</AppBar.Lead>
		<AppBar.Headline class="flex justify-center">
			<h2 class="h4">{title}</h2>
		</AppBar.Headline>
		<AppBar.Trail>
			{@render children?.()}
		</AppBar.Trail>
	</AppBar.Toolbar>
</AppBar>
