<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import Logo from '../icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import AppSettingsMenu from './AppSettingsMenu.svelte';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import type { Snippet } from 'svelte';
	let { children }: { children?: Snippet } = $props();

	const prefs = getPreferences();
	let devMode = $derived(prefs.developerMode);
</script>

<AppBar class="p-2">
	<AppBar.Toolbar class="grid-cols-[1fr_auto]">
		<AppBar.Lead class="flex flex-row items-center justify-start gap-2">
			<a href="/"><Logo /></a>
			<h1 class="h4">
				{m.meta_app_name()}
			</h1>
			{#if devMode}
				<span class="badge preset-filled-warning-500 rounded-full px-2 py-0.5 text-xs uppercase">
					{m.dev_mode_label()}
				</span>
			{/if}
		</AppBar.Lead>
		<AppBar.Trail class="flex items-center justify-end gap-2">
			{@render children?.()}
			<AppSettingsMenu />
		</AppBar.Trail>
	</AppBar.Toolbar>
</AppBar>
