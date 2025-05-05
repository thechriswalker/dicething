<script lang="ts">
	import AppBar from '$lib/components/app_bar/AppBar.svelte';
	import Scroll from '$lib/components/scroll/Scroll.svelte';

	let { children } = $props();
</script>

<AppBar />
<Scroll>
	{@render children()}
</Scroll>
