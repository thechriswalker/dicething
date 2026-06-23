<script lang="ts">
	import {
		PUBLIC_APP_HOSTNAME,
		PUBLIC_GENERAL_AVAILABILITY
	} from '$env/static/public';
	import * as m from '$lib/paraglide/messages';
	import AboutDialog from '$lib/components/about/AboutDialog.svelte';
	import Logo from '$lib/components/icons/Logo.svelte';
	import BouncyDice from '$lib/components/bouncy_dice/BouncyDice.svelte';
	import { MessageCircleQuestion } from '@lucide/svelte';
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
		<Logo />
		<h1 class="h1 mt-4 text-6xl sm:text-8xl">{m.meta_app_name()}</h1>
		<h2 class="h2 text-3xl sm:text-4xl">{m.meta_app_tagline()}</h2>
		{#if PUBLIC_GENERAL_AVAILABILITY !== 'true'}
			<div class="card preset-filled-secondary-500 mt-4 p-4 text-center">
				<p class="h5">{m.not_available_title()}</p>
				<p>{m.not_available_content()}</p>
			</div>
		{/if}
		<div class="my-4 flex flex-row justify-center gap-2">
			<AboutDialog>
				{#snippet trigger(props)}
					<button {...props} class="btn preset-filled-primary-500 flex flex-row items-center gap-1">
						<MessageCircleQuestion size={'24px'} />
						{m.splash_about()}
					</button>
				{/snippet}
			</AboutDialog>
			{#if PUBLIC_GENERAL_AVAILABILITY === 'true'}
				<a href={PUBLIC_APP_HOSTNAME} class="btn btn-lg preset-filled-primary-500">
					{m.splash_start()}
				</a>
			{/if}
		</div>
	</div>
</div>
