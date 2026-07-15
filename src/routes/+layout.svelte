<script lang="ts">
	import { browser } from '$app/environment';
	import UnsupportedBrowser from '$lib/components/browser_support/UnsupportedBrowser.svelte';
	import SmallScreenWarning from '$lib/components/small_screen/SmallScreenWarning.svelte';
	import { checkBrowserSupport } from '$lib/utils/browser_support';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// SSR / prerender: assume support (static adapter ships a SPA shell). The
	// real gate runs client-side before we tear down the HTML fallback.
	const support = browser ? checkBrowserSupport() : { ok: true, missing: [] };

	$effect(() => {
		if (!browser) return;
		// Themed Svelte UI (or a successful boot) replaces the static HTML shell.
		document.getElementById('app-fallback')?.remove();
	});
</script>

{#if browser && !support.ok}
	<UnsupportedBrowser missing={support.missing} />
{:else}
	{#if browser}
		<SmallScreenWarning />
	{/if}
	{@render children()}
{/if}
