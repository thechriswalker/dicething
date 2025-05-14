<script lang="ts">
	import { Menubar } from 'bits-ui';
	import type { MenuData, MenuItem } from './menu.ts';
	import { ChevronRight } from '@lucide/svelte';

	let { data = {} as MenuData } = $props();

	let menus = $derived(Object.keys(data));
	let entries = $derived(Object.values(data));

	const itemBase = 'btn flex w-full flex-row items-center justify-start gap-2';
	const itemClass = ' cursor-pointer';
	const itemDisabled = 'background-surface-200-800 text-surface-300-700 cursor-not-allowed';
	const menuClass =
		'card preset-outlined-surface-500 bg-surface-50-950 flex flex-col gap-2 rounded-md p-1 focus-visible:outline-hidden';
</script>

{#snippet menuitem(item: MenuItem)}
	{@const disabled = !!item.disabled}
	{#if item.type === 'separator'}
		<Menubar.Separator class="hr" />
	{:else if item.type === 'link'}
		<Menubar.Item {disabled} class="{itemBase} {disabled ? itemDisabled : itemClass}">
			{#snippet child({ props })}
				<a href={item.href} {...props}>
					{#if item.icon}
						{@const Icon = item.icon}
						<Icon class="icon-text" />
					{/if}
					{item.title}
				</a>
			{/snippet}
		</Menubar.Item>
	{:else if item.type === 'action'}
		<Menubar.Item
			{disabled}
			onclick={item.action}
			class="{itemBase} {disabled ? itemDisabled : itemClass}"
		>
			{#if item.icon}
				{@const Icon = item.icon}
				<Icon class="icon-text" />
			{/if}
			{item.title}
		</Menubar.Item>
	{:else if item.type === 'submenu'}
		{@const subDisabled = disabled || item.children.length === 0}
		<Menubar.Sub>
			<Menubar.SubTrigger
				disabled={subDisabled}
				class="{itemBase} {subDisabled ? itemDisabled : itemClass}"
			>
				{#if item.icon}
					{@const Icon = item.icon}
					<Icon class="icon-text" />
				{/if}
				<span class="grow">{item.title}</span>
				<ChevronRight class="icon-text" />
			</Menubar.SubTrigger>

			<Menubar.SubContent sideOffset={10} class={menuClass}>
				{#each item.children as child}
					{@render menuitem(child)}
				{/each}
			</Menubar.SubContent>
		</Menubar.Sub>
	{:else if item.type === 'toggle'}
		<Menubar.Item
			{disabled}
			onclick={() => item.onToggle?.(!item.checked)}
			class="{itemBase} {disabled ? itemDisabled : itemClass}"
		>
			{#if item.icon}
				{@const Icon = item.icon}
				<Icon class="icon-text" />
			{/if}
			{item.title}
			<Menubar.CheckboxItem bind:checked={item.checked}>
				{#snippet children({ checked })}
					{checked ? 'On' : 'Off'}
				{/snippet}
			</Menubar.CheckboxItem>
		</Menubar.Item>
	{/if}
{/snippet}

<Menubar.Root class="flex h-full flex-row items-center justify-start gap-2">
	{#if menus.length}
		{#each menus as title, i}
			<Menubar.Menu>
				<Menubar.Trigger class="btn preset-outlined-surface-500">{title}</Menubar.Trigger>
				<Menubar.Portal>
					<Menubar.Content align="start" sideOffset={3} class={menuClass}>
						{#each entries[i] as item}
							{@render menuitem(item)}
						{/each}
					</Menubar.Content>
				</Menubar.Portal>
			</Menubar.Menu>
		{/each}
	{/if}
</Menubar.Root>
