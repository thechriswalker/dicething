<script lang="ts">
	import { browser } from '$app/environment';
	import { Moon, Sun, SunMoon } from '@lucide/svelte';
	import { Popover, Segment } from '@skeletonlabs/skeleton-svelte';
	import { onDestroy, onMount } from 'svelte';

	const LightIcon = Sun;
	const DarkIcon = Moon;
	const SystemIcon = SunMoon;

	let mode = $state(browser ? window.getLightDark() : { mode: '', isDark: false, isLight: false });

	let listener = () => {
		mode = window.getLightDark();
	};
	onMount(() => {
		window.addEventListener('light-dark', listener);
		listener();
	});
	if (browser) {
		onDestroy(() => {
			window.removeEventListener('light-dark', listener);
		});
	}
	function handleValueChange(e: { value: string | null }) {
		window.updateLightDark((e.value as any) || '');
		mode = window.getLightDark();
	}
	let openState = $state(false);
</script>

<Popover
	open={openState}
	onOpenChange={(e) => (openState = e.open)}
	triggerClasses="btn-icon preset-filled-surface-50-950"
	zIndex="1000"
>
	{#snippet content()}
		<Segment
			background="preset-filled-surface-950-50 preset-outlined-surface-200-800 pointer-events-auto z-100"
			indicatorBg="preset-filled-surface-50-950"
			indicatorText="text-surface-contrast-50 dark:text-surface-contrast-950"
			gap="gap-0"
			border="p-1"
			name="lightdark"
			value={mode.mode || 'system'}
			onValueChange={handleValueChange}
		>
			<Segment.Item classes="btn-icon px-2 mx-0" value="light">
				<LightIcon size="18" />
			</Segment.Item>
			<Segment.Item classes="btn-icon px-2 mx-0" value="system">
				<SystemIcon size="18" />
			</Segment.Item>
			<Segment.Item classes="btn-icon px-2 mx-0" value="dark">
				<DarkIcon size="18" />
			</Segment.Item>
		</Segment>
	{/snippet}
	{#snippet trigger()}
		{#if mode.isDark}
			<DarkIcon class="icon-text" />
		{:else if mode.isLight}
			<LightIcon class="icon-text" />
		{/if}
	{/snippet}
</Popover>
