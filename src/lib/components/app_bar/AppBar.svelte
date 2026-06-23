<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import Logo from '../icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import AppSettingsMenu from './AppSettingsMenu.svelte';
	import type { Snippet } from 'svelte';
	let { children }: { children?: Snippet } = $props();
</script>

<AppBar class="p-2">
	<AppBar.Toolbar class="grid-cols-[1fr_auto]">
		<AppBar.Lead class="flex flex-row items-center justify-start gap-2">
			<a href="/"><Logo /></a>
			<h1 class="h4">
				{m.meta_app_name()}
			</h1>
		</AppBar.Lead>
		<AppBar.Trail class="flex items-center justify-end gap-2">
			{@render children?.()}
			<AppSettingsMenu />
		</AppBar.Trail>
	</AppBar.Toolbar>
</AppBar>
