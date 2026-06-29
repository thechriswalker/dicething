<script lang="ts">
	import SplashShell from '$lib/components/layout/SplashShell.svelte';
	import Logo from '$lib/components/icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<SplashShell>
	<div class="flex flex-col items-center gap-2">
		<div class="text-8xl">
			<Logo />
		</div>
		<h1 class="h1">{m.meta_app_name()}</h1>
		<h2 class="h3 text-surface-700">{m.meta_app_tagline()}</h2>
	</div>
</SplashShell>
