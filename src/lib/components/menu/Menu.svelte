<script lang="ts">
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import type { MenuData, MenuItem } from './menu.ts';
	import { CheckIcon, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import MenuLightSwitch from './MenuLightSwitch.svelte';

	let {
		data,
		submenuOnLeft = false,
		class: triggerClasses = 'btn preset-outlined-surface-500'
	}: {
		data: MenuData;
		submenuOnLeft?: boolean;
		class?: string;
	} = $props();

	const itemBase =
		'btn flex w-full flex-row items-center justify-start gap-2 outline-hidden focus:preset-filled-primary-500 z-1000';
	const itemClass = ' cursor-pointer';
	const itemDisabled = 'background-surface-200-800 text-surface-300-700 cursor-not-allowed';
	const menuClass =
		'card preset-outlined-surface-500 bg-surface-50-950 flex flex-col gap-2 rounded-md p-1 focus-visible:outline-hidden';
</script>

{#snippet titleContent(title: string | Snippet)}
	{#if typeof title === 'string'}
		{title}
	{:else}
		{@render title()}
	{/if}
{/snippet}

{#snippet menuitem(item: MenuItem, id: string)}
	{@const disabled = !!item.disabled}
	{#if item.type === 'separator'}
		<Menu.Separator />
	{:else if item.type === 'lightswitch'}
		<MenuLightSwitch
			{disabled}
			class="{itemBase} {disabled ? itemDisabled : itemClass}"
			{submenuOnLeft}
			{menuClass}
		/>
	{:else if item.type === 'link'}
		<Menu.Item value={id} {disabled} class="{itemBase} {disabled ? itemDisabled : itemClass}">
			<a href={item.href} class="contents">
				{#if item.icon}
					{@const Icon = item.icon}
					<Menu.ItemIndicator>
						<Icon class="icon-text" />
					</Menu.ItemIndicator>
				{/if}
				<Menu.ItemText>
					{@render titleContent(item.title)}
				</Menu.ItemText>
			</a>
		</Menu.Item>
	{:else if item.type === 'action'}
		<Menu.Item
			value={id}
			{disabled}
			onclick={item.action}
			class="{itemBase} {disabled ? itemDisabled : itemClass}"
		>
			{#if item.icon}
				{@const Icon = item.icon}
				<Menu.ItemIndicator>
					<Icon class="icon-text" />
				</Menu.ItemIndicator>
			{/if}
			<Menu.ItemText>
				{@render titleContent(item.title)}
			</Menu.ItemText>
		</Menu.Item>
	{:else if item.type === 'legend'}
		<Menu.Item
			value={id}
			{disabled}
			onclick={item.action}
			class="{itemBase} {disabled ? itemDisabled : itemClass}"
		>
			{#if item.icon}
				{@const Icon = item.icon}
				<Menu.ItemIndicator>
					<Icon class="icon-text" />
				</Menu.ItemIndicator>
			{/if}
			<Menu.ItemText class="flex w-full flex-col gap-1">
				{@render titleContent(item.title)}
				<img height="10px" src={item.img} alt="" class="dark:invert" />
			</Menu.ItemText>
		</Menu.Item>
	{:else if item.type === 'submenu'}
		{@const subDisabled = disabled || item.children.length === 0}
		<Menu>
			<Menu.TriggerItem
				value={id}
				disabled={subDisabled}
				class="{itemBase} {subDisabled ? itemDisabled : itemClass}"
				>{#if submenuOnLeft}
					<Menu.ItemIndicator>
						<ChevronLeft class="icon-text" />
					</Menu.ItemIndicator>
				{/if}
				{#if item.icon}
					{@const Icon = item.icon}
					<Menu.ItemIndicator>
						<Icon class="icon-text" />
					</Menu.ItemIndicator>
				{/if}
				<Menu.ItemText>
					{@render titleContent(item.title)}
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
						{#each item.children as child, i}
							{@render menuitem(child, `${id}-${i}`)}
						{/each}
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	{:else if item.type === 'toggle'}
		<Menu.OptionItem
			type="checkbox"
			{disabled}
			checked={!!item.checked}
			onCheckedChange={(checked) => item.onToggle?.(checked)}
			class="{itemBase} {disabled ? itemDisabled : itemClass}"
			value={id}
		>
			{#if item.icon}
				{@const Icon = item.icon}
				<Menu.ItemIndicator>
					<Icon class="icon-text" />
				</Menu.ItemIndicator>
			{/if}
			<Menu.ItemText>
				{@render titleContent(item.title)}
			</Menu.ItemText>
			<Menu.ItemIndicator class="hidden data-[state=checked]:block">
				<CheckIcon class="size-4" />
			</Menu.ItemIndicator>
		</Menu.OptionItem>
	{/if}
{/snippet}

<Menu class="flex h-full flex-row items-center justify-end gap-2">
	<Menu.Trigger class={triggerClasses}>
		{#if data.icon}
			{@const Icon = data.icon}
			<Icon class="icon-text" />
		{/if}
		{@render titleContent(data.title)}
	</Menu.Trigger>
	<Portal>
		<Menu.Positioner>
			<Menu.Content>
				{#each data.children as item, i}
					{@render menuitem(item, `item-${i}`)}
				{/each}
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
