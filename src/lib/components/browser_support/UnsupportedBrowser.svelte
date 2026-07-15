<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { BrowserFeature } from '$lib/utils/browser_support';
	import { PUBLIC_APP_REPO_URL } from '$env/static/public';

	let { missing }: { missing?: Array<BrowserFeature> } = $props();
</script>

<div class="flex min-h-screen w-screen items-center justify-center p-4">
	<div
		class="card preset-glass-surface text-surface-900 flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl p-8 text-center"
	>
		<h1 class="h2">{m.meta_app_name()}</h1>
		<h2 class="h4">{m.browser_unsupported_title()}</h2>
		<p class="text-surface-700">{m.browser_unsupported_message()}</p>
		{#if missing && missing.length > 0}
			<ul class="text-surface-700 w-full list-inside list-disc text-left text-sm">
				{#each missing as feature (feature.id)}
					<li>{feature.label}</li>
				{/each}
			</ul>
		{/if}
		<p class="text-surface-600 text-sm">{m.browser_unsupported_hint()}</p>
		{#if PUBLIC_APP_REPO_URL}
			<a href={PUBLIC_APP_REPO_URL} class="anchor text-sm">{m.browser_unsupported_source()}</a>
		{/if}
	</div>
</div>
