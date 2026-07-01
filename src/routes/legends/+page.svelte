<script lang="ts">
	import { goto } from '$app/navigation';
	import DeleteLegendSetDialog from '$lib/components/delete_legends/DeleteLegendSetDialog.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import builtins, { type Builtin } from '$lib/fonts';
	import { putFont } from '$lib/interfaces/fontstore';
	import {
		cloneLegendSet,
		getSavedLegends,
		importLegendSet,
		saveLegendSet
	} from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { legendSetFromFont, legendSetPreview } from '$lib/utils/create_legends';
	import { download, exportLegendSetJson } from '$lib/utils/export';
	import { defaultStrings } from '$lib/utils/font';
	import { type LegendSet } from '$lib/utils/legends';
	import {
		Copy,
		Download,
		FileText,
		Pencil,
		Plus,
		Trash2,
		Upload
	} from '@lucide/svelte';

	const savedLegends = getSavedLegends();

	// builtins shown in the manager (everything except the empty "blanks" set).
	const builtinList = Object.values(builtins).filter((b) => b.id !== 'blanks');

	let fileInput = $state<HTMLInputElement>();
	let importInput = $state<HTMLInputElement>();
	let busy = $state(false);

	// create-from-font modal state
	let createName = $state('');
	// 'default' uses the standard combined character set; 'custom' lets the user
	// supply their own space-separated token list (order defines the slot layout).
	let createCharsMode = $state<'default' | 'custom'>('default');
	let createChars = $state(defaultStrings);
	let createFile = $state<File | undefined>(undefined);

	async function cloneBuiltin(b: Builtin) {
		busy = true;
		try {
			const set = await b.load();
			const clone = await cloneLegendSet(set);
			await goto('/legends/' + clone.id);
		} finally {
			busy = false;
		}
	}

	async function cloneCustom(set: LegendSet) {
		busy = true;
		try {
			const clone = await cloneLegendSet(set);
			await goto('/legends/' + clone.id);
		} finally {
			busy = false;
		}
	}

	function exportCustom(set: LegendSet) {
		const json = exportLegendSetJson(set);
		const name = (set.name || 'legends').replace(/[^a-z0-9-_]+/gi, '_');
		download(new Blob([json], { type: 'application/json' }), `${name}.legends.json`);
	}

	async function onImportFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) {
			return;
		}
		busy = true;
		try {
			const set = importLegendSet(await file.text());
			await goto('/legends/' + set.id);
		} catch (e) {
			alert(m.legends_import_error({ error: e instanceof Error ? e.message : String(e) }));
		} finally {
			busy = false;
		}
	}

	function onCreateFilePicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		createFile = input.files?.[0];
		if (createFile && !createName) {
			// default the name to the file name without extension.
			createName = createFile.name.replace(/\.[^.]+$/, '');
		}
	}

	async function createFromFont(close: () => void) {
		if (!createFile) {
			return;
		}
		busy = true;
		try {
			const buffer = await createFile.arrayBuffer();
			const name = createName.trim() || createFile.name.replace(/\.[^.]+$/, '');
			const chars =
				createCharsMode === 'custom' && createChars.trim()
					? createChars.trim().replace(/\s+/g, ' ')
					: defaultStrings;
			const set = legendSetFromFont(buffer, name, chars);
			await putFont(set.id, buffer);
			saveLegendSet(set);
			close();
			await goto('/legends/' + set.id);
		} catch (e) {
			alert(m.legends_create_error({ error: e instanceof Error ? e.message : String(e) }));
		} finally {
			busy = false;
		}
	}
</script>

{#snippet setPreview(legends: LegendSet)}
	<img height="20px" src={legendSetPreview(legends)} alt="" class="h-8 self-start dark:invert" />
{/snippet}

<Layout>
	{#snippet header()}
		<h1 class="h4 text-primary-500">{m.legends_title()}</h1>
	{/snippet}

	<div class="mx-auto w-full max-w-5xl p-4">
		<input
			bind:this={importInput}
			type="file"
			accept="application/json,.json"
			class="hidden"
			onchange={onImportFile}
		/>

		<div class="mb-6 flex flex-row flex-wrap items-center justify-end gap-2">
			<button
				class="btn preset-tonal-secondary"
				disabled={busy}
				onclick={() => importInput?.click()}
			>
				<Upload class="size-4" />
				{m.legends_import()}
			</button>
			<Modal>
				{#snippet title()}
					{m.legends_create_title()}
				{/snippet}
				{#snippet trigger(props)}
					<button {...props} class="btn preset-filled-primary-500" disabled={busy}>
						<Plus class="size-4" />
						{m.legends_create_from_font()}
					</button>
				{/snippet}
				{#snippet inner(close)}
					<div class="flex w-80 max-w-full flex-col gap-3">
						<label class="label">
							<span class="label-text">{m.legends_create_name()}</span>
							<input
								class="input"
								type="text"
								bind:value={createName}
								placeholder={m.legends_create_name_placeholder()}
							/>
						</label>
						<label class="label">
							<span class="label-text">{m.legends_create_font()}</span>
							<input
								bind:this={fileInput}
								class="input"
								type="file"
								accept=".ttf,.otf,font/ttf,font/otf"
								onchange={onCreateFilePicked}
							/>
						</label>
						<fieldset class="flex flex-col gap-1">
							<legend class="label-text mb-1">{m.legends_create_preset()}</legend>
							<label class="flex flex-row items-center gap-2">
								<input type="radio" class="radio" value="default" bind:group={createCharsMode} />
								<span>{m.legends_create_chars_default()}</span>
							</label>
							<label class="flex flex-row items-center gap-2">
								<input type="radio" class="radio" value="custom" bind:group={createCharsMode} />
								<span>{m.legends_create_chars_custom()}</span>
							</label>
						</fieldset>
						{#if createCharsMode === 'custom'}
							<label class="label">
								<span class="label-text">{m.legends_create_chars_label()}</span>
								<textarea class="textarea" rows="4" bind:value={createChars}></textarea>
								<span class="text-surface-600-400 text-xs">{m.legends_create_chars_help()}</span>
							</label>
						{/if}
						<div class="flex flex-row justify-end gap-2">
							<button
								class="btn preset-filled-primary-500"
								disabled={busy || !createFile}
								onclick={() => createFromFont(close)}
							>
								{m.legends_create_submit()}
							</button>
						</div>
					</div>
				{/snippet}
			</Modal>
		</div>

		<h2 class="h3 mb-3">{m.legends_custom_header()}</h2>
		{#if savedLegends.length > 0}
			<div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each savedLegends as set (set.id)}
					<div class="card preset-filled-surface-100-900 flex flex-col gap-2 p-3">
						<div class="flex flex-row items-start justify-between gap-2">
							<h3 class="text-lg font-semibold">{set.name}</h3>
						</div>
						{@render setPreview(set)}
						<div class="mt-2 flex flex-row flex-wrap gap-2">
							<button
								class="btn btn-sm preset-tonal-primary"
								onclick={() => goto('/legends/' + set.id)}
							>
								<Pencil class="size-4" />
								{m.legends_edit()}
							</button>
							<button
								class="btn btn-sm preset-tonal-surface"
								disabled={busy}
								onclick={() => cloneCustom(set)}
							>
								<Copy class="size-4" />
								{m.legends_clone()}
							</button>
							<button class="btn btn-sm preset-tonal-surface" onclick={() => exportCustom(set)}>
								<Download class="size-4" />
								{m.legends_export()}
							</button>
							<DeleteLegendSetDialog legendId={set.id} legendName={set.name}>
								{#snippet trigger(props)}
									<button {...props} type="button" class="btn btn-sm preset-tonal-error">
										<Trash2 class="size-4" />
										{m.legends_delete()}
									</button>
								{/snippet}
							</DeleteLegendSetDialog>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="card preset-filled-warning-500 mb-8 px-3 py-2">{m.legends_no_custom()}</p>
		{/if}

		<h2 class="h3 mb-3">{m.legends_builtins_header()}</h2>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each builtinList as b (b.id)}
				<div class="card preset-filled-surface-100-900 flex flex-col gap-2 p-3">
					<h3 class="text-lg font-semibold">{b.name}</h3>
					<img height="20px" src={b.preview} alt="" class="h-8 self-start dark:invert" />
					<div class="mt-2 flex flex-row flex-wrap gap-2">
						<button
							class="btn btn-sm preset-tonal-primary"
							disabled={busy}
							onclick={() => cloneBuiltin(b)}
						>
							<Copy class="size-4" />
							{m.legends_clone()}
						</button>
						{#if b.license}
							<Modal>
								{#snippet title()}
									{m.legends_license_title()}
								{/snippet}
								{#snippet trigger(props)}
									<button {...props} type="button" class="btn btn-sm preset-tonal-surface">
										<FileText class="size-4" />
										{m.legends_license()}
									</button>
								{/snippet}
								{#snippet inner(_close)}
									<pre
										class="max-h-[60vh] max-w-[80vw] overflow-auto text-sm whitespace-pre-wrap">{b.license}</pre>
								{/snippet}
							</Modal>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</Layout>
