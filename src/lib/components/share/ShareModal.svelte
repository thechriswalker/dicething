<script lang="ts">
	import Modal from '$lib/components/modal/Modal.svelte';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import type { DiceSet } from '$lib/interfaces/storage.svelte';
	import { buildShareUrl, classifyShareUrl } from '$lib/utils/share';
	import { Share2, Copy, Check } from '@lucide/svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		set,
		open = $bindable(false),
		showTrigger = true
	}: {
		set: DiceSet;
		open?: boolean;
		showTrigger?: boolean;
	} = $props();

	// Build the link lazily/reactively. exportSetJson rebuilds each die to find
	// the legends it uses, so we only want to do it while the modal is mounted.
	let url = $derived.by(() => {
		try {
			return buildShareUrl(set, page.url.origin);
		} catch (e) {
			console.warn('failed to build share url', e);
			return '';
		}
	});
	let size = $derived(url ? classifyShareUrl(url) : 'ok');

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;
	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = false), 2000);
		} catch (e) {
			console.warn('clipboard write failed', e);
		}
	}
</script>

{#snippet title()}
	<div class="flex flex-row items-center justify-start gap-4 text-4xl">
		<Share2 class="icon-text" />
		{m.share_modal_title()}
	</div>
{/snippet}

{#snippet trigger(props: HTMLButtonAttributes)}
	<button {...props} class="btn preset-outlined-surface-500">
		<Share2 class="icon-text" />
		{m.share_button()}
	</button>
{/snippet}

{#snippet inner()}
	<div class="flex w-[min(90vw,36rem)] flex-col gap-4">
		<p class="text-surface-600-400">{m.share_modal_description()}</p>

		<textarea
			class="textarea h-32 font-mono text-xs"
			readonly
			value={url}
			onclick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
		></textarea>

		<div class="flex items-center justify-between gap-4">
			<span class="text-surface-600-400 text-xs">
				{m.share_size_label({ size: url.length })}
			</span>
			<button class="btn preset-filled-primary-500" onclick={copy} disabled={!url}>
				{#if copied}
					<Check class="icon-text" />
					{m.share_copied()}
				{:else}
					<Copy class="icon-text" />
					{m.share_copy()}
				{/if}
			</button>
		</div>

		{#if size === 'large'}
			<p class="preset-filled-warning-500 rounded-md p-2">{m.share_warning_large()}</p>
		{:else if size === 'huge'}
			<p class="preset-filled-error-500 rounded-md p-2">{m.share_warning_huge()}</p>
		{/if}
	</div>
{/snippet}

<Modal bind:open {title} {inner} trigger={showTrigger ? trigger : undefined} />
