<script lang="ts">
	import SplashShell from '$lib/components/layout/SplashShell.svelte';
	import { m } from '$lib/paraglide/messages';
	import { page } from '$app/state';

	let status = $derived(page.status);
	let isNotFound = $derived(status === 404);
	let title = $derived(isNotFound ? m.error_404_title() : m.error_generic_title());
	let message = $derived(
		page.error?.message && !isNotFound
			? page.error.message
			: isNotFound
				? m.error_404_message()
				: m.error_generic_message()
	);
</script>

<SplashShell>
	<div class="card preset-filled-error-500 flex w-full flex-col items-center gap-2 rounded-xl p-6">
		<h2 class="h3">{title}</h2>
		<p class="text-xl opacity-90">{message}</p>
	</div>
</SplashShell>
