import { Icon } from '@lucide/svelte';

export type MenuData = Record<string, MenuItem[]>; // ie. File -> [New, Save, ...]

type MenuItemBase = {
	title: string;
	icon?: typeof Icon;
	disabled?: boolean;
};

export type MenuSeparator = MenuItemBase & { type: 'separator' };
export type MenuItemLink = MenuItemBase & { type: 'link'; href: string };
export type MenuItemAction = MenuItemBase & { type: 'action'; action?: () => any };
export type MenuItemSubmenu = MenuItemBase & { type: 'submenu'; children: MenuItem[] };
export type MenuItemToggle = MenuItemBase & {
	type: 'toggle';
	checked?: boolean;
	onToggle?: (newValue: boolean) => any;
};

export type MenuItem =
	| MenuItemAction
	| MenuItemLink
	| MenuItemSubmenu
	| MenuItemToggle
	| MenuSeparator;
