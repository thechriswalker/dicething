<script lang="ts">
	import { browser } from '$app/environment';
	import { m } from '$lib/paraglide/messages';
	import { onMount } from 'svelte';

	/** Layout viewport below this is considered too narrow for comfortable use. */
	const MIN_WIDTH_PX = 1024;
	const DISMISS_KEY = 'dt:small-screen-dismissed';

	let tooNarrow = $state(false);
	let dismissed = $state(false);

	onMount(() => {
		if (!browser) return;

		dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';

		const mq = window.matchMedia(`(max-width: ${MIN_WIDTH_PX - 1}px)`);
		const sync = () => {
			tooNarrow = mq.matches;
		};
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	function dismiss() {
		dismissed = true;
		sessionStorage.setItem(DISMISS_KEY, '1');
	}

	const show = $derived(tooNarrow && !dismissed);
</script>

{#if show}
	<div
		class="bg-surface-50-950/60 fixed inset-0 z-[100] flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="small-screen-title"
	>
		<div
			class="card preset-glass-surface text-surface-900 flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl p-8 text-center"
		>
			<h1 class="h2">{m.meta_app_name()}</h1>
			<h2 id="small-screen-title" class="h4">{m.small_screen_title()}</h2>
			<p class="text-surface-700">{m.small_screen_message()}</p>
			<p class="text-surface-600 text-sm">{m.small_screen_hint()}</p>
			<button type="button" class="btn preset-filled-primary-500" onclick={dismiss}>
				{m.small_screen_continue()}
			</button>
		</div>
	</div>
{/if}
