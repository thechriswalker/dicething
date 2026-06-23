<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Layout from '$lib/components/layout/Layout.svelte';
	import LegendPreview from '$lib/components/legend_viewer/LegendPreview.svelte';
	import LegendViewer from '$lib/components/legend_viewer/LegendViewer.svelte';
	import builtins from '$lib/fonts';
	import { getCustomLegendSet, saveLegendSet } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { debounce } from '$lib/utils/debounce';
	import { Legend, type MutableLegendSet } from '$lib/utils/legends';
	import { ArrowLeftIcon } from '@lucide/svelte';

	let id = $derived(page.params.id ?? '');
	// where to return to (e.g. the dice builder that sent us here).
	let returnTo = $derived(page.url.searchParams.get('return') || '/legends');

	let set = $derived<MutableLegendSet | undefined>(getCustomLegendSet(id));
	let selectedLegend = $state<Legend>(Legend.BLANK);

	// keep an editable name in sync with the loaded set.
	let name = $state('');
	let lastSyncedId = '';
	$effect(() => {
		if (set && set.id !== lastSyncedId) {
			lastSyncedId = set.id;
			name = set.name;
		}
	});

	const saveDebounced = debounce<MutableLegendSet>(400, (s) => saveLegendSet(s));

	function onNameInput() {
		if (set) {
			set.name = name;
			saveDebounced(set);
		}
	}

	// resolve the human-readable font source + license for display.
	let fontSource = $derived.by(() => {
		const f = set?.font;
		if (!f) {
			return { label: m.legends_editor_no_font(), license: '' };
		}
		if (f.kind === 'builtin') {
			const b = builtins[f.builtinId as keyof typeof builtins];
			return {
				label: m.legends_editor_builtin_font({ name: b?.name ?? f.builtinId }),
				license: b?.license ?? ''
			};
		}
		return { label: m.legends_editor_uploaded_font(), license: '' };
	});
</script>

<Layout>
	{#snippet header()}
		<a class="btn btn-sm preset-tonal-surface" href={returnTo}>
			<ArrowLeftIcon class="size-4" />
			{m.legends_back()}
		</a>
		<h1 class="h4 text-primary-500">{set?.name ?? m.legends_title()}</h1>
	{/snippet}

	<div class="mx-auto w-full max-w-5xl p-4">
		{#if !set}
			<p class="card preset-filled-error-500 px-3 py-2">{m.legends_editor_not_found()}</p>
			<button class="btn preset-tonal-primary mt-4" onclick={() => goto('/legends')}>
				<ArrowLeftIcon class="size-4" />
				{m.legends_back()}
			</button>
		{:else}
			<div class="flex flex-col gap-4">
				<label class="label max-w-md">
					<span class="label-text">{m.legends_editor_set_name()}</span>
					<input class="input" type="text" bind:value={name} oninput={onNameInput} />
				</label>

				<div class="text-surface-600-400 flex flex-col gap-1 text-sm">
					<span>{m.legends_editor_font_source()}: {fontSource.label}</span>
				</div>

				<div class="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
					<div class="card preset-filled-surface-100-900 p-3">
						<LegendViewer
							legends={set}
							{selectedLegend}
							onSelectedLegend={(l) => (selectedLegend = l)}
						/>
					</div>
					<div class="card preset-filled-surface-100-900 flex w-full flex-col items-center gap-2 p-3 md:w-64">
						<LegendPreview legends={set} legend={selectedLegend} class="size-32" />
						<span class="text-center font-semibold">{set.getLegendName(selectedLegend)}</span>
						<p class="text-surface-600-400 text-center text-sm">
							{m.legends_editor_select_hint()}
						</p>
					</div>
				</div>
			</div>
		{/if}
	</div>
</Layout>
