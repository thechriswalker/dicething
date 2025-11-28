<script lang="ts">
	import { browser } from '$app/environment';
	import { Moon, Sun, SunMoon } from '@lucide/svelte';
	import { Popover, Portal, SegmentedControl } from '@skeletonlabs/skeleton-svelte';
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
</script>

<Popover>
	<Popover.Trigger class="btn-icon preset-filled-surface-50-950">
		{#if mode.isDark}
			<DarkIcon class="icon-text" />
		{:else if mode.isLight}
			<LightIcon class="icon-text" />
		{/if}
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner>
			<Popover.Content>
				<Popover.Description>
					<SegmentedControl defaultValue={mode.mode || 'system'} onValueChange={handleValueChange}>
						<SegmentedControl.Control>
							<SegmentedControl.Indicator />
							<SegmentedControl.Item value="light" title="light" aria-label="light">
								<SegmentedControl.ItemText class="btn-icon px-2 mx-0">
									<LightIcon size="18" />
								</SegmentedControl.ItemText>
								<SegmentedControl.ItemHiddenInput />
							</SegmentedControl.Item>
							<SegmentedControl.Item value="system" title="system" aria-label="system">
								<SegmentedControl.ItemText class="btn-icon px-2 mx-0">
									<SystemIcon size="18" />
								</SegmentedControl.ItemText>
								<SegmentedControl.ItemHiddenInput />
							</SegmentedControl.Item>
							<SegmentedControl.Item value="dark" title="dark" aria-label="dark">
								<SegmentedControl.ItemText class="btn-icon px-2 mx-0">
									<DarkIcon size="18" />
								</SegmentedControl.ItemText>
								<SegmentedControl.ItemHiddenInput />
							</SegmentedControl.Item>
						</SegmentedControl.Control>
					</SegmentedControl>
				</Popover.Description>
			</Popover.Content>
		</Popover.Positioner>
	</Portal>	
</Popover>
