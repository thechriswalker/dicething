<script lang="ts">
	import AboutDialog from '$lib/components/about/AboutDialog.svelte';
	import PreferencesDialog from '$lib/components/preferences/PreferencesDialog.svelte';
	import Menu from '$lib/components/menu/Menu.svelte';
	import type { MenuItemSubmenu } from '$lib/components/menu/menu';
	import { m } from '$lib/paraglide/messages';
	import {
		Box,
		MessageCircleQuestion,
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
				type: 'action',
				title: m.splash_about(),
				icon: MessageCircleQuestion,
				action: () => {
					aboutOpen = true;
				}
			}
		]
	};
</script>

<Menu data={settingsMenu} submenuOnLeft class="btn-icon preset-outlined-surface-500" />
<AboutDialog bind:open={aboutOpen} />
<PreferencesDialog bind:open={prefsOpen} />
