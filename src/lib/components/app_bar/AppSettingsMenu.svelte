<script lang="ts">
	import AboutDialog from '$lib/components/about/AboutDialog.svelte';
	import Menu from '$lib/components/menu/Menu.svelte';
	import type { MenuItemSubmenu } from '$lib/components/menu/menu';
	import { m } from '$lib/paraglide/messages';
	import { FileType, MessageCircleQuestion, Settings } from '@lucide/svelte';

	let aboutOpen = $state(false);

	const settingsMenu: MenuItemSubmenu = {
		type: 'submenu',
		title: '',
		icon: Settings,
		children: [
			{ type: 'lightswitch' },
			{
				type: 'link',
				title: m.nav_legends(),
				icon: FileType,
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
