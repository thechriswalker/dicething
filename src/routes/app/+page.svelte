<script lang="ts">
	import Layout from '$lib/components/layout/Layout.svelte';
	import Logo from '$lib/components/icons/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import { DicesIcon, FileTypeIcon } from '@lucide/svelte';
</script>

<Layout>
	<div class="flex min-h-full flex-col items-center justify-center p-4">
		<div
			class="card preset-filled-surface-100-900 flex w-full max-w-2xl flex-col items-center gap-6 p-8 text-center"
		>
			<div class="flex flex-col items-center gap-2">
				<div class="text-8xl">
					<Logo />
				</div>
				<h1 class="h1">{m.meta_app_name()}</h1>
				<h2 class="h3 text-surface-600-400">{m.meta_app_tagline()}</h2>
			</div>

			<p class="max-w-prose">{m.home_intro()}</p>

			<div class="flex w-full flex-col justify-center gap-4 sm:flex-row">
				<a href="/dice" class="btn btn-lg preset-filled-primary-500 flex-1">
					<DicesIcon class="size-5" />
					{m.home_create_dice()}
				</a>
				<a href="/legends" class="btn btn-lg preset-filled-secondary-500 flex-1">
					<FileTypeIcon class="size-5" />
					{m.home_create_legends()}
				</a>
			</div>
		</div>
	</div>
</Layout>
