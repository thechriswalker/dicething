<script lang="ts">
	import Modal from '$lib/components/modal/Modal.svelte';
	import SupportSettingsFields from '$lib/components/supports/SupportSettingsFields.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { SupportLayerVisibility, SupportSettings } from '$lib/utils/supports/types';
	import { UtilityPole } from '@lucide/svelte';

	let {
		settings,
		layers,
		usingGlobal,
		onSetting,
		onLayer,
		onMakeGlobal,
		onUseGlobal,
		open = $bindable(false)
	}: {
		settings: SupportSettings;
		layers: SupportLayerVisibility;
		usingGlobal: boolean;
		onSetting: <K extends keyof SupportSettings>(key: K, value: SupportSettings[K]) => void;
		onLayer: <K extends keyof SupportLayerVisibility>(
			key: K,
			value: SupportLayerVisibility[K]
		) => void;
		onMakeGlobal: () => void;
		onUseGlobal: () => void;
		open?: boolean;
	} = $props();
</script>

{#snippet title()}
	<div class="flex flex-row items-center justify-start gap-4 text-4xl">
		<UtilityPole class="icon-text" />
		{m.set_supports_title()}
	</div>
{/snippet}

{#snippet inner()}
	<div class="flex max-h-[70vh] w-[min(90vw,24rem)] flex-col gap-3 overflow-y-auto">
		<p class="text-surface-600-400 text-sm">
			{usingGlobal ? m.set_supports_global_hint() : m.set_supports_custom_hint()}
		</p>
		<SupportSettingsFields {settings} {layers} {onSetting} {onLayer} />
		<div class="flex flex-col gap-2 pt-1">
			<button type="button" class="btn preset-filled-primary-500" onclick={onMakeGlobal}>
				{m.set_supports_make_global()}
			</button>
			<button
				type="button"
				class="btn preset-tonal"
				disabled={usingGlobal}
				onclick={onUseGlobal}
			>
				{m.set_supports_use_global()}
			</button>
		</div>
	</div>
{/snippet}

<Modal bind:open {title} {inner} />
