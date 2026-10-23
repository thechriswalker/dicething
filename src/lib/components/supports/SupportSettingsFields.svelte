<script lang="ts">
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		SUPPORT_SETTING_LIMITS,
		type SupportLayerVisibility,
		type SupportSettings
	} from '$lib/utils/supports/types';
	import { Info } from '@lucide/svelte';

	let {
		settings,
		layers,
		onSetting,
		onLayer
	}: {
		settings: SupportSettings;
		layers: SupportLayerVisibility;
		onSetting: <K extends keyof SupportSettings>(key: K, value: SupportSettings[K]) => void;
		onLayer: <K extends keyof SupportLayerVisibility>(
			key: K,
			value: SupportLayerVisibility[K]
		) => void;
	} = $props();

	const limits = SUPPORT_SETTING_LIMITS;

	const numberFields: Array<{
		key: keyof SupportSettings;
		label: () => string;
		help: () => string;
		unit: 'mm' | 'deg';
	}> = [
		{
			key: 'pillarDiameterMm',
			label: m.export_opt_supports_pillar_label,
			help: m.export_opt_supports_pillar_help,
			unit: 'mm'
		},
		{
			key: 'coneLengthMm',
			label: m.export_opt_supports_cone_label,
			help: m.export_opt_supports_cone_help,
			unit: 'mm'
		},
		{
			key: 'sphereDiameterMm',
			label: m.export_opt_supports_sphere_label,
			help: m.export_opt_supports_sphere_help,
			unit: 'mm'
		},
		{
			key: 'raftDepthMm',
			label: m.export_opt_supports_raft_label,
			help: m.export_opt_supports_raft_help,
			unit: 'mm'
		},
		{
			key: 'raftSizeMm',
			label: m.export_opt_supports_raft_size_label,
			help: m.export_opt_supports_raft_size_help,
			unit: 'mm'
		},
		{
			key: 'edgeInsetMm',
			label: m.export_opt_supports_inset_label,
			help: m.export_opt_supports_inset_help,
			unit: 'mm'
		},
		{
			key: 'edgeSpacingMm',
			label: m.export_opt_supports_spacing_label,
			help: m.export_opt_supports_spacing_help,
			unit: 'mm'
		},
		{
			key: 'legendSpacingMm',
			label: m.export_opt_supports_legend_spacing_label,
			help: m.export_opt_supports_legend_spacing_help,
			unit: 'mm'
		},
		{
			key: 'faceMinAngleDeg',
			label: m.export_opt_supports_face_angle_label,
			help: m.export_opt_supports_face_angle_help,
			unit: 'deg'
		},
		{
			key: 'maxHeadLeanDeg',
			label: m.export_opt_supports_lean_label,
			help: m.export_opt_supports_lean_help,
			unit: 'deg'
		},
		{
			key: 'postDiameterMm',
			label: m.export_opt_supports_post_diameter_label,
			help: m.export_opt_supports_post_diameter_help,
			unit: 'mm'
		},
		{
			key: 'postFinThicknessMm',
			label: m.export_opt_supports_post_fin_label,
			help: m.export_opt_supports_post_fin_help,
			unit: 'mm'
		}
	];

	function formatValue(v: number): string {
		const rounded = Math.round(v * 100) / 100;
		return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
	}
</script>

{#snippet help(text: string)}
	<Tooltip content={text} side="left">
		{#snippet children(props)}
			<span
				{...props}
				role="button"
				tabindex={0}
				class="text-surface-500 hover:text-primary-500 inline-flex shrink-0 items-center"
				aria-label={text}
			>
				<Info class="size-3" />
			</span>
		{/snippet}
	</Tooltip>
{/snippet}

<div class="border-surface-300-700 flex flex-col gap-1 border-t pt-2">
	<label class="flex items-center justify-between gap-2 text-xs">
		<span class="flex items-center gap-1">
			<span>{m.supports_layer_edges()}</span>
			{@render help(m.supports_layer_edges_help())}
		</span>
		<input
			type="checkbox"
			class="checkbox"
			checked={layers.edges}
			onchange={(e) => onLayer('edges', e.currentTarget.checked)}
		/>
	</label>
	<label class="flex items-center justify-between gap-2 text-xs">
		<span class="flex items-center gap-1">
			<span>{m.supports_layer_legends()}</span>
			{@render help(m.supports_layer_legends_help())}
		</span>
		<input
			type="checkbox"
			class="checkbox"
			checked={layers.legends}
			onchange={(e) => onLayer('legends', e.currentTarget.checked)}
		/>
	</label>
	<label class="flex items-center justify-between gap-2 text-xs">
		<span class="flex items-center gap-1">
			<span>{m.supports_layer_tip_post()}</span>
			{@render help(m.supports_layer_tip_post_help())}
		</span>
		<input
			type="checkbox"
			class="checkbox"
			checked={layers.tipPost}
			onchange={(e) => onLayer('tipPost', e.currentTarget.checked)}
		/>
	</label>
</div>

{#each numberFields as field (field.key)}
	{@const limit = limits[field.key]}
	<label class="flex flex-col gap-0.5 text-xs">
		<span class="flex items-baseline justify-between gap-2">
			<span class="flex items-center gap-1">
				<span>{field.label()}</span>
				{@render help(field.help())}
			</span>
			<span class="text-surface-600-400 tabular-nums">
				{formatValue(settings[field.key])}{field.unit === 'deg' ? '°' : ' mm'}
			</span>
		</span>
		<input
			type="range"
			min={limit.min}
			max={limit.max}
			step={limit.step}
			value={settings[field.key]}
			oninput={(e) => onSetting(field.key, Number(e.currentTarget.value))}
		/>
	</label>
{/each}
