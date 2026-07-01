<script lang="ts">
	import AboutDialog from '$lib/components/about/AboutDialog.svelte';
	import PreferencesDialog from '$lib/components/preferences/PreferencesDialog.svelte';
	import Menu from '$lib/components/menu/Menu.svelte';
	import type { MenuItemSubmenu } from '$lib/components/menu/menu';
	import { m } from '$lib/paraglide/messages';
	import {
		Box,
		MessageCircleQuestionMark,
		Package,
		Settings,
		SlidersHorizontal,
		TypeOutline
	} from '@lucide/svelte';

	let aboutOpen = $state(false);
	let prefsOpen = $state(false);

	const settingsMenu: MenuItemSubmenu = {
		type: 'submenu',
		title: '',
		icon: Settings,
		children: [
			{
				type: 'action',
				title: m.preferences_menu_label(),
				icon: SlidersHorizontal,
				action: () => {
					prefsOpen = true;
				}
			},
			{
				type: 'link',
				title: m.nav_dice(),
				icon: Box,
				href: '/dice'
			},
			{
				type: 'link',
				title: m.nav_legends(),
				icon: TypeOutline,
				href: '/legends'
			},
			{
				type: 'link',
				title: boxesTitle,
				icon: Package,
				href: '/boxes'
			},
			{
				type: 'action',
				title: m.splash_about(),
				icon: MessageCircleQuestionMark,
				action: () => {
					aboutOpen = true;
				}
			}
		]
	};
</script>

{#snippet boxesTitle()}
	<span class="inline-flex items-center gap-2">
		{m.home_create_boxes()}
		<span class="badge preset-filled-warning-500 rounded-full px-2 py-0.5 text-xs uppercase">
			{m.beta_label()}
		</span>
	</span>
{/snippet}

<Menu data={settingsMenu} submenuOnLeft class="btn-icon preset-outlined-surface-500" />
<AboutDialog bind:open={aboutOpen} />
<PreferencesDialog bind:open={prefsOpen} />
