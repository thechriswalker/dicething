<script lang="ts">
	import Modal from '$lib/components/modal/Modal.svelte';
	import builtins, { isBuiltin, type Builtin } from '$lib/fonts';
	import { m } from '$lib/paraglide/messages';
	import { legendSetPreview } from '$lib/utils/create_legends';
	import type { LegendSet } from '$lib/utils/legends';
	import { PencilIcon, TypeOutline } from '@lucide/svelte';

	let {
		current,
		savedLegends,
		onEdit,
		onSelectCustom,
		onSelectBuiltin
	}: {
		current: LegendSet;
		savedLegends: Array<LegendSet>;
		onEdit: () => void;
		onSelectCustom: (set: LegendSet) => void;
		onSelectBuiltin: (b: Builtin) => void;
	} = $props();

	// builtins shown as choices (everything except the empty "blanks" set, which
	// is offered as its own card below).
	const builtinList = Object.values(builtins).filter((b) => b.id !== 'blanks');

	let currentIsBuiltin = $derived(isBuiltin(current.id));

	// builtins ship a prebuilt preview SVG; custom sets are rendered on the fly.
	function previewFor(set: LegendSet): string {
		if (isBuiltin(set.id)) {
			const key = set.id.slice('builtin:'.length) as keyof typeof builtins;
			return builtins[key]?.preview ?? '';
		}
		return legendSetPreview(set);
	}
</script>

{#snippet previewCard(opts: {
	name: string;
	preview: string;
	selected: boolean;
	onclick: () => void;
})}
	{@const border = opts.selected
		? 'preset-filled-primary-500 preset-outlined-primary-500'
		: 'preset-filled-surface-50-950 preset-outlined hover:preset-outlined-primary-500'}
	<button
		class={'flex flex-col justify-between gap-2 rounded-md p-2 ' + border}
		onclick={opts.onclick}
	>
		<strong>{opts.name}</strong>
		<div class="flex h-[24px] items-center justify-center">
			{#if opts.preview}
				<img src={opts.preview} alt={opts.name} class="max-h-[24px] dark:invert" />
			{/if}
		</div>
	</button>
{/snippet}

<Modal>
	{#snippet title()}
	<div class="flex flex-row items-center justify-start gap-4 text-4xl">
	    <TypeOutline class="icon-text" /> {m.menu_legends()}
	</div>
	{/snippet}
	{#snippet trigger(props)}
		<button {...props} class="btn preset-outlined-surface-500">
			<TypeOutline class="icon-text" />
			{m.menu_legends()}
		</button>
	{/snippet}
	{#snippet inner(close)}
		<div class="flex w-[90vw] flex-col gap-4">
			<section class="flex flex-row items-end justify-start gap-4">
					<div
						class="preset-filled-surface-50-950 preset-outlined flex flex-col gap-2 rounded-md p-3"
					>
						<strong>{current.name}</strong>
						<div class="flex h-[24px] items-center">
							{#if previewFor(current)}
								<img
									src={previewFor(current)}
									alt={current.name}
									class="h-[24px] dark:invert"
								/>
							{/if}
						</div>
					</div>
					<button
						class="btn preset-filled-primary-500"
						onclick={() => {
							onEdit();
							close();
						}}
					>
						<PencilIcon class="size-4" />
						{currentIsBuiltin ? m.legends_clone_builtin_edit() : m.legends_edit_legends()}
					</button>
				
			</section>

			<hr class="hr" />

			<section class="flex flex-col gap-3">
				<p class="h6">{m.legends_modal_change_title()}</p>
				<div class="flex max-h-[50vh] flex-col gap-4 overflow-y-auto pr-1">
					{#if savedLegends.length > 0}
						<div class="flex flex-col gap-2">
							<p class="text-surface-600-400 text-sm font-semibold">{m.menu_custom()}</p>
							<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
								{#each savedLegends as set (set.id)}
									{@render previewCard({
										name: set.name,
										preview: legendSetPreview(set),
										selected: set.id === current.id,
										onclick: () => {
											onSelectCustom(set);
											close();
										}
									})}
								{/each}
							</div>
						</div>
					{/if}
					<div class="flex flex-col gap-2">
						<p class="text-surface-600-400 text-sm font-semibold">{m.menu_builtin()}</p>
						<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
							{@render previewCard({
								name: builtins.blanks.name,
								preview: '',
								selected: builtins.blanks.id === current.id,
								onclick: () => {
									onSelectBuiltin(builtins.blanks);
									close();
								}
							})}
							{#each builtinList as b (b.id)}
								{@render previewCard({
									name: b.name,
									preview: b.preview,
									selected: b.id === current.id,
									onclick: () => {
										onSelectBuiltin(b);
										close();
									}
								})}
							{/each}
						</div>
					</div>
				</div>
			</section>
		</div>
	{/snippet}
</Modal>
