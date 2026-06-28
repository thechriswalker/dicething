<script lang="ts">
	import Layout from '$lib/components/layout/Layout.svelte';
	import Logo from '$lib/components/icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import { BoxIcon, TypeOutlineIcon, GithubIcon, GitBranchIcon, PackageIcon } from '@lucide/svelte';
	import BouncyDice from '$lib/components/bouncy_dice/BouncyDice.svelte';
	import { PUBLIC_APP_REPO_URL, PUBLIC_APP_VERSION } from '$env/static/public';
</script>

<Layout>
	<div class="relative flex min-h-full flex-col items-center justify-center p-4">
		<BouncyDice />
		<div
			class="card preset-glass-surface text-surface-900 z-10 flex w-full max-w-2xl flex-col items-center gap-6 rounded-4xl p-8 text-center"
		>
			<div class="flex flex-col items-center gap-2">
				<div class="text-8xl">
					<Logo />
				</div>
				<h1 class="h1">{m.meta_app_name()}</h1>
				<h2 class="h3 text-surface-700">{m.meta_app_tagline()}</h2>
			</div>

			<div class="sm:flex-row1 flex w-full flex-col justify-center gap-4">
				<a href="/dice" class="btn btn-lg preset-filled-primary-500 flex-1 rounded-xl text-2xl">
					<BoxIcon class="inline-block size-[1em]" />
					{m.home_create_dice()}
				</a>
				<a
					href="/legends"
					class="btn btn-lg preset-filled-secondary-500 flex-1 rounded-xl text-2xl"
				>
					<TypeOutlineIcon class="inline-block size-[1em]" />
					{m.home_create_legends()}
				</a>
				{:if false}
				<!-- until I am happy, let's not make it obvious this exists-->
				<a href="/boxes" class="btn btn-lg preset-filled-tertiary-500 flex-1 rounded-xl text-2xl">
					<PackageIcon class="inline-block size-[1em]" />
					{m.home_create_boxes()}
				</a>
				{/if}
			</div>
			<div class="text-surface-700 flex w-full flex-row items-center justify-center gap-4 text-sm">
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
