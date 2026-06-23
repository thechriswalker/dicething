<script lang="ts">
	import Menu from '$lib/components/menu/Menu.svelte';
	import type { MenuItemSubmenu } from '$lib/components/menu/menu';
	import { m } from '$lib/paraglide/messages';
	import { MessageCircleQuestion, Settings } from '@lucide/svelte';

	const settingsMenu: MenuItemSubmenu = {
		type: 'submenu',
		title: '',
		icon: Settings,
		children: [
			{ type: 'lightswitch' },
			{
				type: 'link',
				title: m.splash_about(),
				href: '/about',
				icon: MessageCircleQuestion
			}
		]
	};
</script>

<Menu data={settingsMenu} submenuOnLeft class="btn-icon preset-outlined-surface-500" />
