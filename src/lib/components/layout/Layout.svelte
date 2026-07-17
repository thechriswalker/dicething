<script lang="ts">
	import '../../../app.css';
	import LightMode from '$lib/components/light_switch/LightMode.svelte';
	import AppBar from '$lib/components/app_bar/AppBar.svelte';
	import Scroll from '$lib/components/scroll/Scroll.svelte';
	import type { Snippet } from 'svelte';
	import LightDarkContext from '../light_switch/LightDarkContext.svelte';

	let { children, header }: { children: Snippet; header?: Snippet } = $props();
</script>

<LightMode />
<LightDarkContext>
	<div class="relative flex h-screen w-screen flex-col overflow-hidden">
		<AppBar
			>{#if header}{@render header()}{/if}
		</AppBar>
		<!-- flex-1 min-h-0 so Scroll's h-full resolves to the remaining viewport
		     under the AppBar (a bare h-full sibling of AppBar is 100vh and overflows). -->
		<div class="min-h-0 flex-1">
			<Scroll>
				{@render children()}
			</Scroll>
		</div>
	</div>
</LightDarkContext>
