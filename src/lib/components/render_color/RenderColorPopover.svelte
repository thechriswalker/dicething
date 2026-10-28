<script lang="ts">
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';

	// Swatch button that opens a small panel with the same native colour input
	// the box preview uses. The panel stays open while the browser colour picker
	// is up: that picker is a browser UI, so its clicks never hit the document.
	let {
		label,
		hint,
		value,
		onChange
	}: {
		label: string;
		hint?: string;
		value: string;
		onChange: (hex: string) => void;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLDivElement | undefined>();

	$effect(() => {
		if (!open) {
			return;
		}
		function onPointerDown(ev: PointerEvent) {
			const target = ev.target;
			if (root && target instanceof Node && root.contains(target)) {
				return;
			}
			open = false;
		}
		function onKey(ev: KeyboardEvent) {
			if (ev.key === 'Escape') {
				open = false;
			}
		}
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="relative" bind:this={root}>
	<Tooltip content={label} side="right" disabled={open}>
		{#snippet children(props)}
			<button
				{...props}
				type="button"
				disabled={false}
				class={'btn-icon relative ' +
					(open ? 'preset-filled-secondary-500' : 'preset-filled-primary-500')}
				aria-label={label}
				aria-expanded={open}
				aria-haspopup="dialog"
				onclick={() => (open = !open)}
			>
				<span
					class="pointer-events-none absolute inset-1.5 rounded-sm ring-1 ring-black/25"
					style:background-color={value}
				></span>
			</button>
		{/snippet}
	</Tooltip>
	{#if open}
		<div
			class="card preset-filled-surface-100-900 border-surface-300-700 absolute top-0 left-full z-20 ml-2 flex w-52 flex-col gap-2 border p-3 text-sm shadow-md"
			role="dialog"
			aria-label={label}
		>
			<label class="flex items-center justify-between gap-2">
				<span>{label}</span>
				<input
					type="color"
					class="h-6 w-10 cursor-pointer rounded"
					aria-label={label}
					{value}
					oninput={(e) => onChange(e.currentTarget.value)}
				/>
			</label>
			{#if hint}
				<p class="text-surface-600-400 text-xs">{hint}</p>
			{/if}
		</div>
	{/if}
</div>
