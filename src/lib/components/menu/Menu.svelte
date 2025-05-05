<script lang="ts">
	import { Menubar } from 'bits-ui';
	import type { MenuData, MenuItem } from './menu.ts';
	import { ChevronRight } from '@lucide/svelte';

	let { data = {} as MenuData } = $props();

	let entries = $derived(Object.entries(data));
</script>

{#snippet menuitem(item: MenuItem)}
	{#if item.type === 'separator'}
		<Menubar.Separator class="hr" />
	{:else if item.type === 'action'}
		<Menubar.Item
			onclick={item.action}
			class="btn hover:preset-filled-surface-500 flex w-full cursor-pointer flex-row items-center justify-start gap-2 "
		>
			{#if item.icon}
				{@const Icon = item.icon}
				<Icon class="icon-text" />
			{/if}
			{item.title}
		</Menubar.Item>
	{:else if item.type === 'submenu'}
		<Menubar.Sub>
			<Menubar.SubTrigger
				class="btn hover:preset-filled-surface-500  justitfy-start flex w-full cursor-pointer flex-row items-center gap-2 pe-0"
			>
				{#if item.icon}
					{@const Icon = item.icon}
					<Icon class="icon-text" />
				{/if}
				<span class="grow">{item.title}</span>
				<ChevronRight class="icon-text" />
			</Menubar.SubTrigger>

			<Menubar.SubContent
				sideOffset={10}
				class="card preset-outlined-surface-500 bg-surface-50-950 flex  flex-col gap-2 rounded-md p-1 focus-visible:outline-hidden"
			>
				{#each item.children as child}
					{@render menuitem(child)}
				{/each}
			</Menubar.SubContent>
		</Menubar.Sub>
	{:else if item.type === 'toggle'}
		<Menubar.Item onclick={() => item.onToggle?.(!item.checked)}>
			{#if item.icon}
				{@const Icon = item.icon}
				<Icon class="icon-text" />
			{/if}
			{item.title}
			<Menubar.CheckboxItem checked={item.checked}>
				{#snippet children({ checked })}
					{checked ? 'On' : 'Off'}
				{/snippet}
			</Menubar.CheckboxItem>
		</Menubar.Item>
	{/if}
{/snippet}

<Menubar.Root class="flex h-full flex-row items-center justify-start gap-2">
	{#if entries.length}
		{#each entries as [title, menuitems]}
			<Menubar.Menu>
				<Menubar.Trigger class="btn preset-outlined-surface-500">{title}</Menubar.Trigger>
				<Menubar.Portal>
					<Menubar.Content
						align="start"
						sideOffset={3}
						class="focus-override card bg-surface-50-950 preset-outlined-surface-500 flex flex-col gap-2 rounded-md p-1 focus-visible:outline-hidden"
					>
						{#each menuitems as item}
							{@render menuitem(item)}
						{/each}
					</Menubar.Content>
				</Menubar.Portal>
			</Menubar.Menu>
		{/each}
	{/if}
</Menubar.Root>
