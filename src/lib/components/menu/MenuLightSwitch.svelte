<script lang="ts">
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import { getLightDarkContext } from '../light_switch/light_dark_context';
	import {
		Check,
		ChevronLeft,
		ChevronRight,
		Moon,
		Sun,
		SunMoon
	} from '@lucide/svelte';
	import { m } from '$lib/paraglide/messages';

	let {
		class: classes,
		disabled,
		submenuOnLeft,
		menuClass
	}: { class: string; disabled: boolean; submenuOnLeft: boolean; menuClass: string } = $props();

	let lightdark = getLightDarkContext();
	const indicatorClass = 'text-surface-400-600 data-[state=checked]:text-surface-950-50';
	const textClass = 'justify-left flex flex-row items-center gap-2 data-[state=checked]:font-bold';
</script>

<Menu>
	<Menu.TriggerItem value="lightswitch" {disabled} class={classes}
		>{#if submenuOnLeft}
			<Menu.ItemIndicator>
				<ChevronLeft class="icon-text" />
			</Menu.ItemIndicator>
		{/if}
		{#if lightdark.isLight}
			<Sun class="icon-text" />
		{:else}
			<Moon class="icon-text" />
		{/if}
		<Menu.ItemText>
			{m.menu_theme()}
		</Menu.ItemText>
		{#if !submenuOnLeft}
			<Menu.ItemIndicator>
				<ChevronRight class="icon-text" />
			</Menu.ItemIndicator>
		{/if}
	</Menu.TriggerItem>
	<Portal>
		<Menu.Positioner>
			<Menu.Content>
				<Menu.OptionItem
					type="radio"
					checked={lightdark.mode === 'dark'}
					onCheckedChange={(checked) => {
						if (checked) {
							window.updateLightDark('dark');
						}
					}}
					value={'dark'}
				>
					<Menu.ItemText class={textClass}>
						<Moon class="icon-text" />
						{m.menu_theme_dark()}
					</Menu.ItemText>
					<Menu.ItemIndicator class={indicatorClass}>
						<Check class="size-4" />
					</Menu.ItemIndicator>
				</Menu.OptionItem>
				<Menu.OptionItem
					type="radio"
					checked={lightdark.mode === 'system'}
					onCheckedChange={(checked) => {
						if (checked) {
							window.updateLightDark('');
						}
					}}
					value={'system'}
				>
					<Menu.ItemText class={textClass}>
						<SunMoon class="icon-text" />
						{m.menu_theme_system()}
					</Menu.ItemText>
					<Menu.ItemIndicator class={indicatorClass}>
						<Check class="size-4" />
					</Menu.ItemIndicator>
				</Menu.OptionItem>
				<Menu.OptionItem
					type="radio"
					checked={lightdark.mode === 'light'}
					onCheckedChange={(checked) => {
						if (checked) {
							window.updateLightDark('light');
						}
					}}
					value={'light'}
				>
					<Menu.ItemText class={textClass}>
						<Sun class="icon-text" />
						{m.menu_theme_light()}
					</Menu.ItemText>
					<Menu.ItemIndicator class={indicatorClass}>
						<Check class="size-4" />
					</Menu.ItemIndicator>
				</Menu.OptionItem>
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
