<script lang="ts">
	import Layout from '$lib/components/layout/Layout.svelte';
	import Logo from '$lib/components/icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import { BoxIcon, TypeOutlineIcon, GithubIcon, GitBranchIcon } from '@lucide/svelte';
	import BouncyDice from '$lib/components/bouncy_dice/BouncyDice.svelte';
	import { PUBLIC_APP_REPO_URL, PUBLIC_APP_VERSION } from '$env/static/public';
</script>

<Layout>
	<div class="flex min-h-full flex-col items-center justify-center p-4 relative">
		<BouncyDice />
		<div
			class="card z-10 rounded-4xl preset-glass-surface flex w-full max-w-2xl flex-col items-center gap-6 p-8 text-center text-surface-900"
		>
			<div class="flex flex-col items-center gap-2">
				<div class="text-8xl">
					<Logo />
				</div>
				<h1 class="h1 ">{m.meta_app_name()}</h1>
				<h2 class="h3 text-surface-700">{m.meta_app_tagline()}</h2>
			</div>
			
			<div class="flex w-full flex-col justify-center gap-4 sm:flex-row1">
				<a href="/dice" class="btn btn-lg preset-filled-primary-500 flex-1 text-2xl">
						<BoxIcon class="size-[1em] inline-block" />
						{m.home_create_dice()}
				</a>
				<a href="/legends" class="btn btn-lg preset-filled-secondary-500 flex-1 text-2xl">
					<TypeOutlineIcon class="size-[1em] inline-block" />
					{m.home_create_legends()}
				</a>
			</div>
			<div
				class="flex w-full flex-row items-center justify-center gap-4 text-sm text-surface-700"
			>
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
