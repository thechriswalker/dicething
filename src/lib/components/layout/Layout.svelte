<script lang="ts">
	import '../../../app.css';
	import LightMode from '$lib/components/light_switch/LightMode.svelte';
	import AppBar from '$lib/components/app_bar/AppBar.svelte';
	import Scroll from '$lib/components/scroll/Scroll.svelte';
	import type { Snippet } from 'svelte';

	let {
		children,
		header,
		title = ''
	}: { title?: string; children: Snippet; header?: Snippet } = $props();
</script>

<LightMode />
<div class="relative flex h-screen w-screen flex-col overflow-hidden">
	<AppBar {title}
		>{#if header}{@render header()}{/if}
	</AppBar>
	<Scroll>
		{@render children()}
	</Scroll>
</div>
