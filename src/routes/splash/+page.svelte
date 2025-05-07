<script lang="ts">
	import { Github } from '@lucide/svelte';
	import {
		PUBLIC_APP_HOSTNAME,
		PUBLIC_GENERAL_AVAILABILITY,
		PUBLIC_APP_REPO_URL,
		PUBLIC_APP_VERSION
	} from '$env/static/public';
	import * as m from '$lib/paraglide/messages';
	import Logo from '$lib/components/icons/Logo.svelte';
	import BouncyDice from '$lib/components/bouncy_dice/BouncyDice.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
</script>

<svelte:boundary
	onerror={(e) => {
		console.warn((e as any).stack);
	}}
>
	<BouncyDice />
	{#snippet failed()}
		<h1>FAIL</h1>
	{/snippet}
</svelte:boundary>
<div class="pointer-events-none z-10 flex h-screen items-center justify-center">
	<div
		class="card preset-glass-neutralx pointer-events-auto flex flex-col items-center justify-center p-8"
	>
		<Logo size="128" />
		<h1 class="h1 mt-4 text-6xl sm:text-8xl">{m['meta.app_name']()}</h1>
		<h2 class="h2 text-3xl sm:text-4xl">{m['meta.app_tagline']()}</h2>
		{#if PUBLIC_GENERAL_AVAILABILITY !== 'true'}
			<div class="card preset-filled-secondary-500 mt-4 p-4 text-center">
				<p class="h5">{m['not_available.title']()}</p>
				<p>{m['not_available.content']()}</p>
			</div>
		{/if}
		<div class="my-4 flex flex-row justify-center gap-2">
			<Tooltip side="bottom">
				<a href={PUBLIC_APP_REPO_URL} class="btn preset-filled-primary-500 flex flex-row gap-1">
					<Github size={'24px'} /> Source on Github
				</a>
				{#snippet content()}
					<smaller>
						{PUBLIC_APP_VERSION}
					</smaller>
				{/snippet}
			</Tooltip>
			{#if PUBLIC_GENERAL_AVAILABILITY === 'true'}
				<a href={PUBLIC_APP_HOSTNAME} class="btn btn-lg preset-filled-primary-500">
					{m['splash.start']()}
				</a>
			{/if}
		</div>
	</div>
</div>
