<script lang="ts">
	import {
		Dialog,
		Portal,
		useDialog,
		SegmentedControl,
		Switch,
		Tabs
	} from '@skeletonlabs/skeleton-svelte';
	import { Moon, Settings, Sun, SunMoon, XIcon } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { m } from '$lib/paraglide/messages';
	import { getPreferences, setPreference } from '$lib/interfaces/preferences.svelte';
	import { engravingParam, engravingToleranceParam } from '$lib/utils/builder';
	import Slider from '$lib/components/slider/Slider.svelte';
	import builtins from '$lib/fonts';
	import { getSavedLegends } from '$lib/interfaces/storage.svelte';
	import { legendSetPreview } from '$lib/utils/create_legends';
	import { getLightDarkContext } from '$lib/components/light_switch/light_dark_context';

	const animation =
		'transition transition-discrete opacity-0 translate-y-[100px] starting:data-[state=open]:opacity-0 starting:data-[state=open]:translate-y-[100px] data-[state=open]:opacity-100 data-[state=open]:translate-y-0';

	let {
		open = $bindable(false),
		trigger
	}: {
		open?: boolean;
		trigger?: Snippet<[HTMLButtonAttributes]>;
	} = $props();

	let id = $props.id();
	let dialog = useDialog(() => ({
		id,
		open,
		onOpenChange: (e) => {
			open = e.open;
		}
	}));

	const prefs = getPreferences();
	const savedLegends = getSavedLegends();
	const builtinList = Object.values(builtins).filter((f) => f.id !== 'blanks');

	const lightdark = getLightDarkContext();
	function handleThemeChange(e: { value: string | null }) {
		const mode = (e.value as 'light' | 'dark' | 'system') || 'system';
		window.updateLightDark(mode === 'system' ? '' : mode);
	}
</script>

<Dialog.Provider value={dialog}>
	{#if trigger}
		<Dialog.Trigger>
			{#snippet element(props)}
				{@render trigger(props)}
			{/snippet}
		</Dialog.Trigger>
	{/if}
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card preset-filled-surface-100-900 max-h-[85vh] w-full max-w-2xl space-y-4 overflow-hidden p-4 pb-8 shadow-xl {animation}"
			>
				<header class="flex items-start justify-between gap-4">
					<Dialog.Title class="h1 flex items-center gap-4">
						<Settings class="icon-text" />
						{m.preferences_title()}
					</Dialog.Title>
					<Dialog.CloseTrigger class="btn-icon hover:preset-tonal shrink-0">
						<XIcon class="size-4" />
					</Dialog.CloseTrigger>
				</header>
				<Dialog.Description class="max-h-[calc(85vh-5rem)] overflow-y-auto">
					<Tabs defaultValue="general">
						<Tabs.List class="border-surface-300-700 flex gap-2 border-b">
							<Tabs.Trigger
								value="general"
								class="btn hover:preset-tonal data-[selected]:preset-filled-primary-500"
							>
								{m.preferences_tab_general()}
							</Tabs.Trigger>
							<Tabs.Trigger
								value="defaults"
								class="btn hover:preset-tonal data-[selected]:preset-filled-primary-500"
							>
								{m.preferences_tab_defaults()}
							</Tabs.Trigger>
							<Tabs.Trigger
								value="developer"
								class="btn hover:preset-tonal data-[selected]:preset-filled-primary-500"
							>
								{m.preferences_tab_developer()}
							</Tabs.Trigger>
						</Tabs.List>

						<Tabs.Content value="general" class="pt-4">
							<div class="flex flex-col gap-4">
								<div class="flex flex-col gap-2">
									<p class="h5">{m.menu_theme()}</p>
									<SegmentedControl value={lightdark.mode} onValueChange={handleThemeChange}>
										<SegmentedControl.Control>
											<SegmentedControl.Indicator class="bg-primary-500" />
											<SegmentedControl.Item value="light">
												<SegmentedControl.ItemText class="flex items-center gap-2 px-2">
													<Sun size="18" />
													{m.menu_theme_light()}
												</SegmentedControl.ItemText>
												<SegmentedControl.ItemHiddenInput />
											</SegmentedControl.Item>
											<SegmentedControl.Item value="system">
												<SegmentedControl.ItemText class="flex items-center gap-2 px-2">
													<SunMoon size="18" />
													{m.menu_theme_system()}
												</SegmentedControl.ItemText>
												<SegmentedControl.ItemHiddenInput />
											</SegmentedControl.Item>
											<SegmentedControl.Item value="dark">
												<SegmentedControl.ItemText class="flex items-center gap-2 px-2">
													<Moon size="18" />
													{m.menu_theme_dark()}
												</SegmentedControl.ItemText>
												<SegmentedControl.ItemHiddenInput />
											</SegmentedControl.Item>
										</SegmentedControl.Control>
									</SegmentedControl>
								</div>
							</div>
						</Tabs.Content>

						<Tabs.Content value="defaults" class="pt-4">
							<div class="flex flex-col gap-6">
								<label class="flex flex-col gap-1">
									<p class="flex items-center justify-between">
										<span class="h5">{m.preferences_default_engraving_depth()}</span>
										<span>({prefs.defaultEngravingDepth})</span>
									</p>
									<p class="text-surface-600-400 text-sm">
										{m.preferences_default_engraving_depth_hint()}
									</p>
									<Slider
										class="py-1"
										value={prefs.defaultEngravingDepth}
										onChange={(v) => setPreference('defaultEngravingDepth', v)}
										min={engravingParam.min}
										max={engravingParam.max}
										step={engravingParam.step}
									/>
								</label>

								<label class="flex flex-col gap-1">
									<p class="flex items-center justify-between">
										<span class="h5">{m.preferences_default_engraving_tolerance()}</span>
										<span>({prefs.defaultEngravingTolerance})</span>
									</p>
									<p class="text-surface-600-400 text-sm">
										{m.preferences_default_engraving_tolerance_hint()}
									</p>
									<Slider
										class="py-1"
										value={prefs.defaultEngravingTolerance}
										onChange={(v) => setPreference('defaultEngravingTolerance', v)}
										min={engravingToleranceParam.min}
										max={engravingToleranceParam.max}
										step={engravingToleranceParam.step}
									/>
								</label>

								<div class="flex flex-col gap-2">
									<p class="h5">{m.preferences_default_legend_set()}</p>
									{#if savedLegends.length > 0}
										<p class="text-surface-600-400 text-sm font-semibold">
											{m.preset_options_custom()}
										</p>
										<div class="grid grid-cols-3 gap-3">
											{#each savedLegends as set (set.id)}
												{@const border =
													set.id === prefs.defaultLegendSet
														? 'preset-filled-primary-500 preset-outlined-primary-500'
														: 'preset-filled-surface-50-950 preset-outlined hover:preset-outlined-primary-500'}
												<button
													class={'flex flex-col justify-between gap-2 rounded-md p-2 ' + border}
													onclick={() => setPreference('defaultLegendSet', set.id)}
												>
													<strong>{set.name}</strong>
													<div class="flex h-[24px] items-center justify-center">
														<img
															src={legendSetPreview(set)}
															alt={m.preset_options_font_preview()}
															class="max-h-[24px] dark:invert"
														/>
													</div>
												</button>
											{/each}
										</div>
									{/if}
									<p class="text-surface-600-400 text-sm font-semibold">
										{m.preset_options_builtin()}
									</p>
									<div class="grid grid-cols-3 gap-3">
										{#each builtinList as f (f.id)}
											{@const border =
												f.id === prefs.defaultLegendSet
													? 'preset-filled-primary-500 preset-outlined-primary-500'
													: 'preset-filled-surface-50-950 preset-outlined hover:preset-outlined-primary-500'}
											<button
												class={'flex flex-col justify-between gap-2 rounded-md p-2 ' + border}
												onclick={() => setPreference('defaultLegendSet', f.id)}
											>
												<strong>{f.name}</strong>
												<div class="flex h-[24px] items-center justify-center">
													<img
														src={f.preview}
														alt={m.preset_options_font_preview()}
														class="max-h-[24px] dark:invert"
													/>
												</div>
											</button>
										{/each}
									</div>
								</div>
							</div>
						</Tabs.Content>

						<Tabs.Content value="developer" class="pt-4">
							<div class="flex flex-col gap-4">
								<Switch
									checked={prefs.developerMode}
									onCheckedChange={(d) => setPreference('developerMode', d.checked)}
								>
									<Switch.Label>{m.preferences_developer_mode()}</Switch.Label>
									<Switch.Control>
										<Switch.Thumb />
									</Switch.Control>
									<Switch.HiddenInput />
								</Switch>
								<p class="text-surface-600-400 text-sm">{m.preferences_developer_mode_hint()}</p>
							</div>
						</Tabs.Content>
					</Tabs>
				</Dialog.Description>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog.Provider>
