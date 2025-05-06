<script lang="ts">
	import { goto } from '$app/navigation';
	import { menu } from '$lib/components/app_bar/AppBarMenu.svelte';
	import type { MenuItem } from '$lib/components/menu/menu';
	import Time from '$lib/components/time/Time.svelte';
	import type { Preset } from '$lib/interfaces/presets';
	import { getSavedSets, saveSet } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { fromPreset, presets } from '$lib/presets';
	import { Dice1 } from '@lucide/svelte';

	let savedSets = getSavedSets();

	async function handlePreset(fn: Preset) {
		const set = await fromPreset(fn);
		saveSet(set);
		goto('/editor/' + set.id);
	}

	const menuItems: MenuItem[] = [
		{
			title: 'New Set',
			icon: Dice1,
			type: 'action',
			action: () => goto('/editor/new')
		},
		{
			title: 'Saved Sets',
			type: 'submenu',
			children: savedSets.map((set) => ({
				title: set.name,
				type: 'action',
				action: () => goto(`/editor/${set.id}`)
			}))
		}
	];
</script>

<div class="flex min-h-full flex-col items-center justify-center" use:menu={{ file: menuItems }}>
	<div class="card preset-filled-surface-100-900 p-4">
		<h2 class="h2 my-4">{m['start.new_set_header']()}</h2>
		<div class="m-auto my-2 grid max-w-216 auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2">
			{#each Object.entries(presets) as [preset, fn]}
				<button
					class="btn preset-tonal-surface hover:preset-outlined-primary-500 block flex w-full flex-col justify-start gap-1 border-[1px] border-transparent text-wrap"
					onclick={() => handlePreset(fn)}
				>
					<h6 class="h4">
						{m['presets.title']({ preset })}
					</h6>
					<p class="">{m['presets.description']({ preset })}</p>
				</button>
			{/each}
		</div>
		<hr class="hr my-4" />
		<h2 class="h2 my-4 flex flex-row items-center justify-between">
			<span>{m['start.load_set_header']()}</span>
			<button
				class="btn btn-lg preset-tonal-secondary hidden font-normal sm:block"
				onclick={() => alert('not implemented yet :(')}>{m['start.import']()}</button
			>
		</h2>
		<button
			class="btn preset-tonal-secondary btn-lg my-4 block w-full sm:hidden"
			onclick={() => alert('not implemented yet :(')}>{m['start.import']()}</button
		>

		{#if savedSets.length > 0}
			<div class="my-2 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2">
				{#each savedSets as set}
					<button
						class="btn preset-tonal-primary flex flex-col justify-start gap-1 text-wrap"
						onclick={() => goto('/editor/' + set.id)}
					>
						<h6 class="text-xl">{set.name}</h6>
						<p><Time t={set.updated} /></p>
					</button>
				{/each}
			</div>
		{:else}
			<p>{m['start.no_saved_sets']()}</p>
		{/if}
		<p></p>
	</div>
</div>
