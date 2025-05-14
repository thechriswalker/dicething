<script lang="ts">
	import '../../app.css';
	import LightMode from '$lib/components/light_switch/LightMode.svelte';

	let { children } = $props();
</script>

<LightMode />
<div class="relative flex h-screen w-screen flex-col overflow-hidden">
	{@render children()}
</div>
