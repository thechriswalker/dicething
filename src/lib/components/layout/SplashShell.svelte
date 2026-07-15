<script lang="ts">
	import Layout from '$lib/components/layout/Layout.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Box, TypeOutline, GitBranch, Package } from '@lucide/svelte';
	import BouncyDice from '$lib/components/bouncy_dice/BouncyDice.svelte';
	import { PUBLIC_APP_REPO_URL, PUBLIC_APP_VERSION } from '$env/static/public';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const prefs = getPreferences();
	let devMode = $derived(prefs.developerMode);
</script>

<Layout>
	<div class="relative flex min-h-full flex-col items-center justify-center p-4">
		<BouncyDice />
		<div
			class="card preset-glass-surface text-surface-900 z-10 flex w-full max-w-2xl flex-col items-center gap-6 rounded-4xl p-8 text-center"
		>
			{@render children()}

			<div class="sm:flex-row1 flex w-full flex-col justify-center gap-4">
				<a href="/dice" class="btn btn-lg preset-filled-primary-500 flex-1 rounded-xl text-2xl">
					<Box class="inline-block size-[1em]" />
					{m.home_create_dice()}
				</a>
				<a
					href="/legends"
					class="btn btn-lg preset-filled-secondary-500 flex-1 rounded-xl text-2xl"
				>
					<TypeOutline class="inline-block size-[1em]" />
					{m.home_create_legends()}
				</a>
				{#if devMode}
					<a
						href="/boxes"
						class="btn btn-lg preset-filled-tertiary-500 relative flex-1 rounded-xl text-2xl"
					>
						<Package class="inline-block size-[1em]" />
						{m.home_create_boxes()}
						<span
							class="badge preset-filled-warning-500 absolute -top-2 -right-2 rounded-full px-2 py-0.5 text-xs uppercase"
						>
							{m.beta_label()}
						</span>
					</a>
				{/if}
			</div>
			<div class="text-surface-700 flex w-full flex-row items-center justify-center gap-4 text-sm">
				<span>{PUBLIC_APP_VERSION}</span>
				<a href={PUBLIC_APP_REPO_URL} class="inline-flex items-center gap-1 hover:underline">
					{#if PUBLIC_APP_REPO_URL.includes('github.com')}
						<GitBranch class="size-4" />
						Source on GitHub
					{:else}
						<GitBranch class="size-4" />
						Source Code
					{/if}
				</a>
			</div>
		</div>
	</div>
</Layout>
