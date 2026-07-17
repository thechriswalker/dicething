<script lang="ts">
	import Layout from '$lib/components/layout/Layout.svelte';

	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const prefs = getPreferences();

	// Box builder is unfinished — only reachable with developer mode on.
	$effect(() => {
		if (browser && !prefs.developerMode) {
			goto('/');
		}
	});
</script>

<Layout>
	{#if prefs.developerMode}
		{@render children()}
	{/if}
</Layout>
