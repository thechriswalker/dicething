<script lang="ts">
	import Layout from '$lib/components/layout/Layout.svelte';
	import Logo from '$lib/components/icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import { BoxIcon, TypeOutlineIcon, GithubIcon, GitBranchIcon, TriangleAlertIcon } from '@lucide/svelte';
	import BouncyDice from '$lib/components/bouncy_dice/BouncyDice.svelte';
	import { PUBLIC_APP_REPO_URL, PUBLIC_APP_VERSION } from '$env/static/public';
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

<Layout>
	<div class="flex min-h-full flex-col items-center justify-center p-4 relative">
		<BouncyDice />
		<div
			class="card z-10 rounded-4xl preset-glass-surface flex w-full max-w-2xl flex-col items-center gap-6 p-8 text-center text-surface-900"
		>

			<div
				class="card preset-filled-error-500 flex w-full flex-col items-center gap-2 rounded-xl p-6"
			>
				<h2 class="h3">{title}</h2>
				<p class="text-xl opacity-90">{message}</p>
			</div>

			<div class="flex w-full flex-col justify-center gap-4 sm:flex-row1">
				<a href="/dice" class="btn btn-lg preset-filled-primary-500 flex-1 text-2xl rounded-xl">
					<BoxIcon class="size-[1em] inline-block" />
					{m.home_create_dice()}
				</a>
				<a href="/legends" class="btn btn-lg preset-filled-secondary-500 flex-1 text-2xl rounded-xl">
					<TypeOutlineIcon class="size-[1em] inline-block" />
					{m.home_create_legends()}
				</a>
			</div>
			<div class="flex w-full flex-row items-center justify-center gap-4 text-sm text-surface-700">
				<span>{PUBLIC_APP_VERSION}</span>
				<a href={PUBLIC_APP_REPO_URL} class="inline-flex items-center gap-1 hover:underline">
					{#if PUBLIC_APP_REPO_URL.includes('github.com')}
						<GithubIcon class="size-4" />
						Source on GitHub
					{:else}
						<GitBranchIcon class="size-4" />
						Source Code
					{/if}
				</a>
			</div>
		</div>
	</div>
</Layout>
