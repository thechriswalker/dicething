<script lang="ts">
	import '../../app.css';
	import LightMode from '$lib/components/light_switch/LightMode.svelte';
	import AppBar from '$lib/components/app_bar/AppBar.svelte';
	import Scroll from '$lib/components/scroll/Scroll.svelte';

	let { children } = $props();
</script>

<LightMode />
<div class="relative flex h-screen w-screen flex-col overflow-hidden">
	<AppBar />
	<Scroll>
		{@render children()}
	</Scroll>
</div>
