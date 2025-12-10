import { Icon } from '@lucide/svelte';
import type { Snippet } from 'svelte';

export type MenuData = MenuItemSubmenu; //the first will be rendered as the menu trigger, and should be a submenu

type MenuItemMinimum = {
	disabled?: boolean;
};
type MenuItemCommon = {
	title: string | Snippet;
	icon?: typeof Icon;
};
type MenuItemBase = MenuItemCommon & MenuItemMinimum;

export type MenuItemLightSwitch = MenuItemMinimum & { type: 'lightswitch' };
export type MenuItemLegend = MenuItemBase & { type: 'legend'; img: string; action?: () => any };
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
	| MenuItemLegend
	| MenuItemLightSwitch
	| MenuSeparator;
