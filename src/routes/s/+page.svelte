<script lang="ts">
	import { goto } from '$app/navigation';
	import DiePreview from '$lib/components/die_preview/DiePreview.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import { saveSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { importSetJson } from '$lib/utils/export';
	import { decodeShareData } from '$lib/utils/share';
	import { AlertTriangle } from '@lucide/svelte';
	import { onMount } from 'svelte';

	type View =
		| { kind: 'loading' }
		| { kind: 'ready'; set: DiceSet }
		| { kind: 'error'; message: string };

	let view = $state<View>({ kind: 'loading' });
	let importing = $state(false);

	onMount(async () => {
		// The payload lives in the fragment (never sent to a server), so we read it
		// straight off window.location rather than via the loaded route data.
		const token = window.location.hash.replace(/^#/, '').trim();
		if (!token) {
			view = { kind: 'error', message: m.share_import_error_empty() };
			return;
		}
		let json: string;
		try {
			json = decodeShareData(token);
		} catch {
			view = { kind: 'error', message: m.share_import_error_invalid() };
			return;
		}
		try {
			const set = await importSetJson(json);
			view = { kind: 'ready', set };
		} catch (e) {
			console.warn('failed to import shared set', e);
			view = { kind: 'error', message: m.share_import_error_invalid() };
		}
	});

	async function doImport() {
		if (view.kind !== 'ready' || importing) {
			return;
		}
		importing = true;
		try {
			saveSet(view.set);
			await goto('/dice/' + view.set.id);
		} catch (e) {
			console.warn('failed to save shared set', e);
			view = { kind: 'error', message: m.share_import_error_invalid() };
			importing = false;
		}
	}
</script>

<Layout>
	<div class="flex min-h-full flex-col items-center justify-center p-4">
		<div class="card preset-filled-surface-100-900 flex max-w-[90vw] flex-col gap-4 p-6">
			{#if view.kind === 'loading'}
				<p class="text-surface-600-400">{m.share_import_loading()}</p>
			{:else if view.kind === 'error'}
				<h1 class="h3 flex items-center gap-2">
					<AlertTriangle class="text-error-500 size-6" />
					{m.share_import_error_title()}
				</h1>
				<p class="text-surface-600-400 max-w-prose">{view.message}</p>
				<div class="flex justify-end">
					<a class="btn preset-tonal-surface" href="/dice">{m.share_import_back()}</a>
				</div>
			{:else}
				<h1 class="h3">{m.share_import_title()}</h1>
				<p class="text-surface-600-400 max-w-prose">{m.share_import_prompt()}</p>

				<div class="flex flex-col gap-1">
					<h2 class="h5">{view.set.name}</h2>
					<p class="text-surface-600-400 text-sm">
						{m.share_import_die_count({ count: view.set.dice.length })}
					</p>
				</div>

				<div class="flex flex-row flex-wrap items-center justify-center gap-2">
					{#each view.set.dice as die (die.id)}
						<DiePreview class="size-16" {die} legends={view.set.legends} />
					{/each}
				</div>

				<div class="flex justify-end gap-2">
					<a class="btn preset-tonal-surface" href="/dice">{m.share_import_cancel()}</a>
					<button class="btn preset-filled-primary-500" onclick={doImport} disabled={importing}>
						{importing ? m.share_import_importing() : m.share_import_confirm()}
					</button>
				</div>
			{/if}
		</div>
	</div>
</Layout>
