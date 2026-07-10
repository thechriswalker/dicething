<script lang="ts">
	import dice from '$lib/dice';
	import type { Dice } from '$lib/interfaces/storage.svelte';
	import type { DiceParameter, FaceParams } from '$lib/interfaces/dice';
	import { isBuiltin } from '$lib/fonts';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		engravingParam,
		engravingToleranceParam,
		type EngravingError
	} from '$lib/utils/builder';
	import type { DieEditorFacade } from '$lib/utils/die_editor_facade';
	import { Legend, type LegendSet } from '$lib/utils/legends';
	import { getOrderings, CUSTOM_ORDERING, STANDARD_ORDERING } from '$lib/utils/legend_orderings';
	import { Vector2 } from 'three';
	import { degToRad, radToDeg } from 'three/src/math/MathUtils.js';
	import {
		TriangleAlert,
		ChevronDown,
		Copy,
		Info,
		Pencil,
		Redo2,
		Undo2
	} from '@lucide/svelte';
	import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import Slider from '$lib/components/slider/Slider.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import LegendViewer from '../legend_viewer/LegendViewer.svelte';
	import LegendPreview from '../legend_viewer/LegendPreview.svelte';
	import Collapsible from '../collapsible/Collapsible.svelte';
	import CollapsibleGroup from '../collapsible/CollapsibleGroup.svelte';

	type SelectMode = 'single' | 'multi' | 'none';

	type Props = {
		kind: Dice['kind'];
		dparams: Dice['parameters'];
		sparams: Record<string, string> | undefined;
		fparams: Dice['face_parameters'];
		ordering: string | undefined;
		legends: LegendSet;
		selectMode: SelectMode;
		selectedFace: number;
		selectedFaces: number[];
		builder: DieEditorFacade;
		renderPass: number;
		// true when this die can come to rest on an inconclusive face (see
		// stability.ts). surfaced as a card at the top of the panel; the message is
		// localised per die kind via m.dice_land_warning.
		landWarning?: boolean;
		// faces whose legend won't engrave cleanly (too large / build failure), so
		// the die would export with broken faces. surfaced as a card at the top of
		// the panel, mirroring the preview-row badge/tooltip.
		engravingErrors?: Array<EngravingError>;
		// bumped by the parent whenever the user re-clicks the already-selected
		// face (which doesn't change the selection key). that's the user asking to
		// see the face controls, so we pop the face section open even if collapsed.
		focusFaceRequest?: number;
		onChangeSelectedFace?: (n: number) => void;
		onApplyToAll?: () => void;
		onEnterFormatPaint?: () => void;
		onSyncFaces?: () => void;
		onEditLegends?: () => void;
		canUndo?: boolean;
		canRedo?: boolean;
		onUndo?: () => void;
		onRedo?: () => void;
	};

	let {
		legends,
		kind,
		dparams = $bindable(),
		sparams = $bindable(),
		fparams = $bindable(),
		ordering = $bindable(),
		selectMode = $bindable(),
		selectedFace = $bindable(),
		selectedFaces = $bindable(),
		builder,
		renderPass,
		landWarning = false,
		engravingErrors = [],
		focusFaceRequest = 0,
		onChangeSelectedFace,
		onApplyToAll,
		onEnterFormatPaint,
		onSyncFaces,
		onEditLegends,
		canUndo = false,
		canRedo = false,
		onUndo,
		onRedo
	}: Props = $props();

	let model = $derived(dice[kind]);

	// the distinct legend names that won't engrave, joined for the consolidated
	// "broken for faces: ..." line (several faces often share one legend).
	let engravingErrorLegends = $derived(
		[...new Set(engravingErrors.map((e) => e.legendName))].join(', ')
	);

	// a parameter (numeric or string) may be gated on another numeric parameter's
	// current value (e.g. show "Rim Segments" only in polygon mode).
	function paramVisible(visibleWhen?: { param: string; equals: number }): boolean {
		if (!visibleWhen) {
			return true;
		}
		const current =
			dparams[visibleWhen.param] ??
			model.parameters.find((p) => p.id === visibleWhen.param)?.defaultValue;
		return Math.round(Number(current)) === visibleWhen.equals;
	}

	// the string-parameter channel is optional on a die; initialize it lazily on
	// first write so the value can be persisted (and bound back to the parent).
	function setStringParam(id: string, value: string) {
		if (!sparams) {
			sparams = {};
		}
		sparams[id] = value;
	}
	const nf = Intl.NumberFormat(undefined, {
		maximumFractionDigits: 2,
		trailingZeroDisplay: 'stripIfInteger'
	});
	function numberFormat(x: string | number): string {
		if (typeof x === 'string') {
			return x;
		}
		return nf.format(x);
	}
	let faces = $derived(renderPass ? builder.getFaces() : []);
	// faces that the user can actually see/edit. `hidden` faces (e.g. the coin's
	// rim segments) are built and exported but never listed or selectable.
	let visibleFaces = $derived(
		faces.map((face, i) => ({ face, i })).filter(({ face }) => !face.hidden)
	);
	// 1 ml = 1 cm³ = 1000 mm³, and we treat the three.js unit as a mm.
	let vol = $derived(renderPass ? builder.getApproximateVolume() / 1000 : '-');
	let f2f = $derived(renderPass ? builder.getFace2FaceDistance() : '-');
	let firstBlank = $derived(faces.findIndex((x) => !x.isNumberFace));
	let engravingDepth = $derived(dparams[engravingParam.id] ?? engravingParam.defaultValue);
	let engravingTolerance = $derived(
		dparams[engravingToleranceParam.id] ?? engravingToleranceParam.defaultValue
	);

	function faceName(face: { isNumberFace: boolean }, i: number): string {
		return face.isNumberFace
			? m.face_parameters_face_name_0_n({ n: i + 1 })
			: m.face_parameters_blank_name_0_n({ n: i + 1 - firstBlank });
	}

	// the faces that edits apply to. in multi mode this is every selected face;
	// in single mode it's just the selected one; in none mode it's empty.
	let targetFaces = $derived.by(() => {
		if (selectMode === 'multi') return selectedFaces;
		if (selectMode === 'single' && selectedFace >= 0) return [selectedFace];
		return [];
	});
	// the face whose values are shown on the sliders. for multi we show the first.
	let displayFace = $derived(targetFaces.length > 0 ? targetFaces[0] : -1);

	// which accordion section is open ('dice' | 'face' | null). controlled so we
	// can pop the face section open when a face gets selected (e.g. by clicking it
	// in the 3D view). 'dice' to start so the panel opens on the die overview.
	let openSection = $state<string | null>('dice');
	// when the active selection changes, jump to the face section. plain (non-$state)
	// tracking var so re-opening doesn't fight the user manually collapsing it.
	// seeded with the initial selection so we don't force it open on first mount.
	let lastSelectionKey = selectMode === 'single' ? `single:${selectedFace}` : selectMode;
	$effect(() => {
		const key = selectMode === 'single' ? `single:${selectedFace}` : selectMode;
		if (key !== lastSelectionKey) {
			lastSelectionKey = key;
			if (selectMode !== 'none') {
				openSection = 'face';
			}
		}
	});
	// re-clicking the already-selected face leaves the selection key unchanged, so
	// the effect above won't fire. honour the parent's explicit focus request by
	// opening the face section. seeded with the initial value so we don't force it
	// open on mount.
	let lastFocusRequest = focusFaceRequest;
	$effect(() => {
		if (focusFaceRequest !== lastFocusRequest) {
			lastFocusRequest = focusFaceRequest;
			if (selectMode !== 'none') {
				openSection = 'face';
			}
		}
	});

	// the current value of the face <select>. driving the select's `value`
	// directly (rather than per-option `selected` attributes) keeps it in sync
	// when the selection is changed programmatically, e.g. by clicking a face in
	// the 3D view. values are strings so face indices and the 'none'/'multi'
	// modes can share one control.
	let faceSelectValue = $derived(selectMode === 'single' ? String(selectedFace) : selectMode);

	// apply a mutation to the FaceParams of every currently targeted face.
	function updateTargetFaces(mutate: (params: FaceParams) => void) {
		for (const i of targetFaces) {
			const params = fparams[i] ?? {};
			mutate(params);
			fparams[i] = params;
		}
	}

	// ---- legend ordering ----
	// the orderings this die kind offers (Standard always, plus Spindown / Go
	// First where applicable). 'custom' isn't listed here; it's surfaced only
	// while it's the active ordering.
	let availableOrderings = $derived(getOrderings(kind));
	let currentOrdering = $derived(ordering ?? STANDARD_ORDERING);
	let isCustomOrdering = $derived(currentOrdering === CUSTOM_ORDERING);
	// pending ordering id awaiting confirmation while leaving the custom ordering.
	let pendingOrdering = $state<string | null>(null);

	// materialise every (non-hidden) face's effective legend into face_parameters,
	// then mark the die "custom". done before a manual legend edit so the rest of
	// the faces keep the legends the previous ordering gave them.
	function bakeToCustom() {
		const built = builder.getFaces();
		for (let i = 0; i < built.length; i++) {
			if (built[i].hidden) {
				continue;
			}
			const params = fparams[i] ?? {};
			if (params.legend === undefined) {
				params.legend = built[i].defaultLegend;
			}
			fparams[i] = params;
		}
		ordering = CUSTOM_ORDERING;
	}

	// switch to a (non-custom) ordering: drop every per-face legend override so the
	// ordering's defaults take over, keeping the other face params (scale/offset/…).
	function switchOrdering(id: string) {
		const built = builder.getFaces();
		for (let i = 0; i < built.length; i++) {
			const params = fparams[i];
			if (params && 'legend' in params) {
				const rest = { ...params };
				delete rest.legend;
				fparams[i] = rest;
			}
		}
		ordering = id;
	}

	// the dropdown changed. leaving the custom ordering drops the hand-edited
	// legends, so confirm first via the interstitial; every other switch is direct.
	function onOrderingSelect(id: string) {
		if (id === currentOrdering) {
			return;
		}
		if (isCustomOrdering) {
			pendingOrdering = id;
			return;
		}
		switchOrdering(id);
	}

	// set the legend on the targeted face(s). a manual legend edit on a
	// non-custom ordering first bakes the current arrangement into custom.
	function setFaceLegend(next: Legend) {
		if (!isCustomOrdering) {
			bakeToCustom();
		}
		updateTargetFaces((p) => (p.legend = next));
	}

	// dev tool: copy the current per-number-face legends as a paste-ready line for
	// src/lib/dice/spindown_orders.ts, so a visually-arranged order can be saved.
	let orderingCopied = $state(false);
	async function copyOrdering() {
		const built = builder.getFaces();
		const values: Array<number> = [];
		for (let i = 0; i < built.length; i++) {
			if (!built[i].isNumberFace) {
				continue;
			}
			values.push(fparams[i]?.legend ?? built[i].defaultLegend);
		}
		const line = `\t${kind}: [${values.join(', ')}],`;
		try {
			await navigator.clipboard.writeText(line);
			orderingCopied = true;
			setTimeout(() => (orderingCopied = false), 2000);
		} catch (e) {
			console.warn('clipboard write failed', e);
		}
	}

	let faceLegend = $derived(fparams[displayFace]?.legend ?? faces[displayFace]?.defaultLegend);
	let faceLegendScale = $derived(
		fparams[displayFace]?.scale ?? builder.getDefaultScaleForLegend(faceLegend)
	);
	let faceLegendOffset = $derived(fparams[displayFace]?.offset ?? new Vector2(0, 0));
	let faceRotationDegrees = $derived(radToDeg(fparams[displayFace]?.rotation ?? 0));
	let faceExtraDepth = $derived(fparams[displayFace]?.extraDepth ?? 0);

	// ---- parameter editing mode: controls / raw / JSON (JSON is dev-only) ----
	const prefs = getPreferences();
	let devMode = $derived(prefs.developerMode);
	type ParamMode = 'controls' | 'raw' | 'json';
	let paramMode = $state<ParamMode>('controls');
	// JSON editing is dev-only; snap back when developer mode is turned off.
	$effect(() => {
		if (!devMode && paramMode === 'json') {
			paramMode = 'controls';
		}
	});
	let widePanel = $derived(devMode || paramMode !== 'controls');

	// every numeric die parameter (model params + the two engraving params) so the
	// raw editor can expose each one as a free text field.
	let allDieParams = $derived<Array<DiceParameter>>([
		...model.parameters,
		engravingParam,
		engravingToleranceParam
	]);

	// raw text drafts so a user can type intermediate/invalid strings (e.g. "-",
	// "1.") without the value being clobbered before it parses.
	let rawDrafts = $state<Record<string, string>>({});
	function rawDieValue(p: DiceParameter): string {
		if (p.id in rawDrafts) {
			return rawDrafts[p.id];
		}
		return String(dparams[p.id] ?? p.defaultValue);
	}
	function setRawDie(p: DiceParameter, text: string) {
		rawDrafts[p.id] = text;
		const n = Number(text);
		// apply ANY finite number the user enters (not clamped to min/max).
		if (text.trim() !== '' && Number.isFinite(n)) {
			dparams[p.id] = n;
		}
	}
	function dieIsSet(p: DiceParameter): boolean {
		return p.id in dparams;
	}
	function setDieUnset(p: DiceParameter, unset: boolean) {
		if (unset) {
			const { [p.id]: _drop, ...rest } = dparams;
			dparams = rest;
		} else {
			dparams[p.id] = dparams[p.id] ?? p.defaultValue;
		}
		const { [p.id]: _d, ...restDraft } = rawDrafts;
		rawDrafts = restDraft;
	}
	function outOfRange(p: DiceParameter, text: string): boolean {
		const n = Number(text);
		if (text.trim() === '' || !Number.isFinite(n)) {
			return true;
		}
		return n < p.min || n > p.max;
	}

	// raw text drafts for per-face fields (keyed by display face + field name).
	let rawFaceDrafts = $state<Record<string, string>>({});
	function rawFaceKey(field: string): string {
		return `face.${displayFace}.${field}`;
	}
	function rawFaceValue(field: string): string {
		const key = rawFaceKey(field);
		if (key in rawFaceDrafts) {
			return rawFaceDrafts[key];
		}
		switch (field) {
			case 'scale':
				return String(faceLegendScale);
			case 'offset.x':
				return String(faceLegendOffset.x);
			case 'offset.y':
				return String(faceLegendOffset.y);
			case 'rotation':
				return String(fparams[displayFace]?.rotation ?? 0);
			case 'extraDepth':
				return String(fparams[displayFace]?.extraDepth ?? 0);
			default:
				return '';
		}
	}
	function setRawFace(field: string, text: string) {
		rawFaceDrafts[rawFaceKey(field)] = text;
		const n = Number(text);
		if (text.trim() === '' || !Number.isFinite(n)) {
			return;
		}
		updateTargetFaces((p) => {
			switch (field) {
				case 'scale':
					p.scale = n;
					break;
				case 'rotation':
					p.rotation = n;
					break;
				case 'extraDepth':
					p.extraDepth = n;
					break;
				case 'offset.x':
					p.offset = (p.offset?.clone() ?? new Vector2(0, 0)).setX(n);
					break;
				case 'offset.y':
					p.offset = (p.offset?.clone() ?? new Vector2(0, 0)).setY(n);
					break;
			}
		});
	}
	type FaceRawField = 'scale' | 'rotation' | 'extraDepth' | 'offset';
	function faceFieldIsSet(field: FaceRawField): boolean {
		if (displayFace < 0) {
			return false;
		}
		const params = fparams[displayFace] ?? {};
		if (field === 'offset') {
			return 'offset' in params;
		}
		return field in params;
	}
	function setFaceFieldUnset(field: FaceRawField, unset: boolean) {
		for (const i of targetFaces) {
			const params = { ...(fparams[i] ?? {}) };
			if (unset) {
				if (field === 'offset') {
					delete params.offset;
				} else {
					delete params[field];
				}
			} else {
				switch (field) {
					case 'scale':
						params.scale =
							fparams[i]?.scale ?? builder.getDefaultScaleForLegend(params.legend ?? faces[i]?.defaultLegend);
						break;
					case 'offset':
						params.offset = (fparams[i]?.offset?.clone() ?? new Vector2(0, 0)).clone();
						break;
					case 'rotation':
						params.rotation = fparams[i]?.rotation ?? 0;
						break;
					case 'extraDepth':
						params.extraDepth = fparams[i]?.extraDepth ?? 0;
						break;
				}
			}
			fparams[i] = params;
		}
		const prefix = `face.${displayFace}.`;
		rawFaceDrafts = Object.fromEntries(
			Object.entries(rawFaceDrafts).filter(([k]) => !k.startsWith(prefix))
		);
	}
	function faceOutOfRange(
		field: string,
		text: string,
		min: number,
		max: number
	): boolean {
		const n = Number(text);
		if (text.trim() === '' || !Number.isFinite(n)) {
			return true;
		}
		return n < min || n > max;
	}

	const faceRawFields = [
		{
			id: 'scale',
			label: () => m.face_parameters_scale(),
			min: 0.1,
			max: 5,
			step: 0.01,
			unsetField: 'scale' as const,
			showUnset: true
		},
		{
			id: 'offset.x',
			label: () => m.face_parameters_offset_x(),
			min: -20,
			max: 20,
			step: 0.1,
			unsetField: 'offset' as const,
			showUnset: true
		},
		{
			id: 'offset.y',
			label: () => m.face_parameters_offset_y(),
			min: -20,
			max: 20,
			step: 0.1,
			unsetField: 'offset' as const,
			showUnset: false
		},
		{
			id: 'rotation',
			label: () => m.face_parameters_rotation(),
			min: -Math.PI,
			max: Math.PI,
			step: 0.01,
			unsetField: 'rotation' as const,
			showUnset: true
		},
		{
			id: 'extraDepth',
			label: () => m.face_parameters_extra_depth(),
			min: -3,
			max: 3,
			step: 0.05,
			unsetField: 'extraDepth' as const,
			showUnset: true
		}
	] as const;

	// ---- JSON editor ----
	function jsonReplacer(_key: string, value: unknown) {
		if (value instanceof Vector2) {
			return { _: 'v2', x: value.x, y: value.y };
		}
		return value;
	}
	function jsonReviver(_key: string, value: any) {
		if (value && typeof value === 'object' && value._ === 'v2') {
			return new Vector2(value.x, value.y);
		}
		return value;
	}
	function currentJson(): string {
		return JSON.stringify(
			{
				parameters: dparams,
				string_parameters: sparams ?? {},
				face_parameters: fparams
			},
			jsonReplacer,
			2
		);
	}
	let jsonText = $state('');
	let jsonError = $state<string | null>(null);
	// (re)load the editor text from the live values whenever we enter JSON mode.
	$effect(() => {
		if (paramMode === 'json') {
			jsonText = currentJson();
			jsonError = null;
		}
	});
	function applyJson() {
		try {
			const parsed = JSON.parse(jsonText, jsonReviver);
			if (!parsed || typeof parsed !== 'object' || typeof parsed.parameters !== 'object') {
				throw new Error('missing "parameters" object');
			}
			dparams = parsed.parameters ?? {};
			sparams = parsed.string_parameters ?? {};
			fparams = parsed.face_parameters ?? [];
			jsonError = null;
		} catch (e) {
			jsonError = e instanceof Error ? e.message : String(e);
		}
	}
	async function copyJson() {
		try {
			await navigator.clipboard.writeText(jsonText);
		} catch (e) {
			console.warn('clipboard write failed', e);
		}
	}
</script>

<!-- a small "i" affordance that reveals help text on hover/focus.
     deliberately a <span>, not a <button>: these rows are wrapped in a <label>,
     and a labelable control (button/input/...) inside it captures clicks meant
     for the slider, stealing focus and popping the tooltip. a span is not
     labelable, so the label keeps forwarding to the real control. tabindex keeps
     the help text reachable by keyboard. -->
{#snippet helpIcon(text: string)}
	<Tooltip content={text} side="left">
		{#snippet children(props)}
			<span
				{...props}
				role="button"
				tabindex={0}
				class="text-surface-500 hover:text-primary-500 inline-flex items-center"
				aria-label={text}
			>
				<Info class="size-3.5" />
			</span>
		{/snippet}
	</Tooltip>
{/snippet}

<div class="card preset-tonal-surface flex flex-col gap-2 p-4 {widePanel ? 'w-108' : 'w-72'}">
	<div class="flex gap-2">
		<button
			type="button"
			class="btn btn-sm preset-tonal-primary flex-1 justify-center"
			aria-label={m.controls_undo()}
			disabled={!canUndo}
			onclick={() => onUndo?.()}
		>
			<Undo2 class="size-4" />
			{m.controls_undo()}
		</button>
		<button
			type="button"
			class="btn btn-sm preset-tonal-primary flex-1 justify-center"
			aria-label={m.controls_redo()}
			disabled={!canRedo}
			onclick={() => onRedo?.()}
		>
			<Redo2 class="size-4" />
			{m.controls_redo()}
		</button>
	</div>
	{#if engravingErrors.length > 0}
		<details class="border-error-500 bg-error-500/10 group rounded-md border text-sm" open>
			<summary
				class="text-error-500 flex cursor-pointer list-none items-center justify-between gap-2 p-3 font-semibold [&::-webkit-details-marker]:hidden"
			>
				<span class="flex items-center gap-2">
					<TriangleAlert class="size-4 shrink-0" />
					{m.engraving_errors_title()}
				</span>
				<ChevronDown class="size-4 shrink-0 transition-transform group-open:rotate-180" />
			</summary>
			<p class="px-3 pb-3">{m.engraving_broken_for_faces({ legends: engravingErrorLegends })}</p>
		</details>
	{/if}
	{#if landWarning}
		<details class="group rounded-md border border-amber-500 bg-amber-500/10 text-sm" open>
			<summary
				class="flex cursor-pointer list-none items-center justify-between gap-2 p-3 font-semibold text-amber-500 [&::-webkit-details-marker]:hidden"
			>
				<span class="flex items-center gap-2">
					<TriangleAlert class="size-4 shrink-0" />
					{m.dice_land_warning_title()}
				</span>
				<ChevronDown class="size-4 shrink-0 transition-transform group-open:rotate-180" />
			</summary>
			<p class="px-3 pb-3">{m.dice_land_warning({ kind })}</p>
		</details>
	{/if}
	<SegmentedControl
		value={paramMode}
		onValueChange={(e) => {
			if (e.value) paramMode = e.value as ParamMode;
		}}
	>
		<SegmentedControl.Control>
			<SegmentedControl.Indicator class="bg-primary-500" />
			<SegmentedControl.Item value="controls">
				<SegmentedControl.ItemText class="data-[state=checked]:text-primary-contrast-500 px-2">
					{m.dice_parameters_mode_controls()}
				</SegmentedControl.ItemText>
				<SegmentedControl.ItemHiddenInput />
			</SegmentedControl.Item>
			<SegmentedControl.Item value="raw">
				<SegmentedControl.ItemText class="data-[state=checked]:text-primary-contrast-500 px-2">
					{m.dice_parameters_mode_raw()}
				</SegmentedControl.ItemText>
				<SegmentedControl.ItemHiddenInput />
			</SegmentedControl.Item>
			{#if devMode}
				<SegmentedControl.Item value="json">
					<SegmentedControl.ItemText class="data-[state=checked]:text-primary-contrast-500 px-2">
						{m.dice_parameters_mode_json()}
					</SegmentedControl.ItemText>
					<SegmentedControl.ItemHiddenInput />
				</SegmentedControl.Item>
			{/if}
		</SegmentedControl.Control>
	</SegmentedControl>
	{#if devMode && paramMode === 'json'}
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<span class="font-semibold">{m.dice_parameters_json_title()}</span>
				<button type="button" class="btn btn-sm preset-tonal-primary" onclick={copyJson}>
					<Copy class="size-4" />
					{m.dice_parameters_json_copy()}
				</button>
			</div>
			<textarea
				class="textarea font-mono text-xs {jsonError ? 'border-error-500' : ''}"
				rows="16"
				spellcheck="false"
				bind:value={jsonText}
			></textarea>
			{#if jsonError}
				<span class="text-error-500 text-sm">{jsonError}</span>
			{/if}
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => {
						jsonText = currentJson();
						jsonError = null;
					}}>{m.dice_parameters_json_reset()}</button
				>
				<button type="button" class="btn btn-sm preset-filled-primary-500" onclick={applyJson}
					>{m.dice_parameters_json_apply()}</button
				>
			</div>
		</div>
	{:else}
		<CollapsibleGroup bind:value={openSection}>
			<Collapsible value="dice" title={m.dice_name({ kind })} defaultOpen={false}>
				{#snippet titleExtra()}
					{@render helpIcon(m.dice_blurb({ kind }))}
				{/snippet}
				<p class="flex justify-between">
					<span>{m.dice_parameters_approx_volume()}:</span>
					<span>{numberFormat(vol)}{typeof vol === 'number' ? ' ml' : ''}</span>
				</p>
				<p class="flex justify-between">
					<span>{m.dice_parameters_face_to_face_distance()}:</span> <span>{numberFormat(f2f)}</span>
				</p>
				<label class="flex flex-col gap-1">
					<span class="flex items-center gap-1">
						{m.dice_parameters_legend_ordering()}:
						{@render helpIcon(m.dice_parameters_legend_ordering_help())}
					</span>
					<select
						class="select"
						value={currentOrdering}
						onchange={(e) => onOrderingSelect((e.target as HTMLSelectElement).value)}
					>
						{#each availableOrderings as o (o.id)}
							<option value={o.id}>{m.legend_ordering_option({ key: o.labelKey })}</option>
						{/each}
						{#if isCustomOrdering}
							<option value={CUSTOM_ORDERING}>
								{m.legend_ordering_option({ key: CUSTOM_ORDERING })}
							</option>
						{/if}
					</select>
				</label>
				{#if devMode}
					<button
						type="button"
						class="btn btn-sm preset-tonal-secondary justify-center"
						onclick={copyOrdering}
					>
						<Copy class="size-4" />
						{orderingCopied
							? m.dice_parameters_copy_ordering_done()
							: m.dice_parameters_copy_ordering()}
					</button>
				{/if}
				{#if paramMode === 'raw'}
					<div class="flex flex-col gap-3">
						{#each allDieParams as p (p.id)}
							{#if paramVisible(p.visibleWhen)}
								<div class="flex flex-col gap-1">
									<p class="flex items-center justify-between gap-2">
										<span class="flex items-center gap-1 truncate">
											{m.dice_parameters_name({ id: p.id })}
											{@render helpIcon(m.dice_parameters_description({ id: p.id }))}
										</span>
										<label class="flex shrink-0 items-center gap-1 text-xs">
											<input
												type="checkbox"
												class="checkbox"
												checked={!dieIsSet(p)}
												onchange={(e) => setDieUnset(p, (e.target as HTMLInputElement).checked)}
											/>
											{m.dice_parameters_raw_unset()}
										</label>
									</p>
									<input
										type="text"
										inputmode="decimal"
										class="input {outOfRange(p, rawDieValue(p)) ? 'border-warning-500' : ''}"
										value={rawDieValue(p)}
										disabled={!dieIsSet(p)}
										oninput={(e) => setRawDie(p, (e.target as HTMLInputElement).value)}
									/>
									<span class="text-surface-500 text-xs">
										{m.dice_parameters_raw_range({ min: p.min, max: p.max, step: p.step })}
									</span>
								</div>
							{/if}
						{/each}
						{#each model.stringParameters ?? [] as p (p.id)}
							{#if paramVisible(p.visibleWhen)}
								<label class="flex flex-col gap-1">
									<span>{m.dice_parameters_name({ id: p.id })}</span>
									<textarea
										class="textarea font-mono text-xs"
										rows="2"
										spellcheck="false"
										value={sparams?.[p.id] ?? p.defaultValue}
										oninput={(e) => setStringParam(p.id, (e.target as HTMLTextAreaElement).value)}
									></textarea>
								</label>
							{/if}
						{/each}
					</div>
				{:else}
					{#each model.parameters as p}
						{@const currentValue = dparams[p.id] ?? p.defaultValue}
						{#if paramVisible(p.visibleWhen)}
							{#if p.display?.kind === 'toggle'}
								<div id="parameter-{p.id}" class="flex flex-col gap-1">
									<p class="flex items-center justify-between">
										<span class="flex items-center gap-1">
											{m.dice_parameters_name({ id: p.id })}:
											{@render helpIcon(m.dice_parameters_description({ id: p.id }))}
										</span>
									</p>
									<SegmentedControl
										value={String(currentValue)}
										onValueChange={(e) => {
											if (e.value != null) dparams[p.id] = Number(e.value);
										}}
									>
										<SegmentedControl.Control>
											<SegmentedControl.Indicator class="bg-primary-500" />
											{#each p.display.options as opt}
												<SegmentedControl.Item value={String(opt.value)}>
													<SegmentedControl.ItemText
														class="data-[state=checked]:text-primary-contrast-500"
													>
														{m.dice_parameter_option({ key: opt.label })}
													</SegmentedControl.ItemText>
													<SegmentedControl.ItemHiddenInput />
												</SegmentedControl.Item>
											{/each}
										</SegmentedControl.Control>
									</SegmentedControl>
								</div>
							{:else}
								<label id="parameter-{p.id}" class="flex flex-col">
									<p class="flex items-center justify-between">
										<span class="flex items-center gap-1">
											{m.dice_parameters_name({ id: p.id })}:
											{@render helpIcon(m.dice_parameters_description({ id: p.id }))}
										</span>
										<span>({currentValue})</span>
									</p>
									<!-- Bits UI Slider component! -->

									<Slider
										class="py-1"
										value={currentValue}
										onChange={(newValue) => (dparams[p.id] = newValue)}
										min={p.min}
										max={p.max}
										step={p.step}
									/>
								</label>
							{/if}
						{/if}
					{/each}
					{#each model.stringParameters ?? [] as p}
						{#if paramVisible(p.visibleWhen)}
							{@const value = sparams?.[p.id] ?? p.defaultValue}
							{@const validation = p.validate?.(value)}
							<label id="parameter-{p.id}" class="flex flex-col">
								<p class="flex items-center justify-between">
									<span class="flex items-center gap-1">
										{m.dice_parameters_name({ id: p.id })}:
										{@render helpIcon(m.dice_parameters_description({ id: p.id }))}
									</span>
								</p>
								<textarea
									class="textarea {validation && !validation.valid ? 'border-error-500' : ''}"
									rows="3"
									spellcheck="false"
									{value}
									oninput={(e) => setStringParam(p.id, (e.target as HTMLTextAreaElement).value)}
								></textarea>
								{#if validation && !validation.valid && validation.error}
									<span class="text-error-500 mt-1 text-sm">
										{m.dice_parameter_message({ key: validation.error })}
									</span>
								{:else if validation && validation.warning}
									<span class="text-warning-500 mt-1 text-sm">
										{m.dice_parameter_message({ key: validation.warning })}
									</span>
								{/if}
							</label>
						{/if}
					{/each}
					<label id="parameter-{engravingParam.id}" class="flex flex-col">
						<p class="flex items-center justify-between">
							<span class="flex items-center gap-1">
								{m.dice_parameters_name({ id: engravingParam.id })}:
								{@render helpIcon(m.dice_parameters_description({ id: engravingParam.id }))}
							</span>
							<span>
								({engravingDepth})
							</span>
						</p>
						<!-- Bits UI Slider component! -->

						<Slider
							class="py-1"
							value={engravingDepth}
							onChange={(e) => (dparams[engravingParam.id] = e)}
							min={engravingParam.min}
							max={engravingParam.max}
							step={engravingParam.step}
						></Slider>
					</label>
					<label id="parameter-{engravingToleranceParam.id}" class="flex flex-col">
						<p class="flex items-center justify-between">
							<span class="flex items-center gap-1">
								{m.dice_parameters_name({ id: engravingToleranceParam.id })}:
								{@render helpIcon(
									m.dice_parameters_description({ id: engravingToleranceParam.id })
								)}
							</span>
							<span>
								({engravingTolerance})
							</span>
						</p>
						<Slider
							class="py-1"
							value={engravingTolerance}
							onChange={(e) => (dparams[engravingToleranceParam.id] = e)}
							min={engravingToleranceParam.min}
							max={engravingToleranceParam.max}
							step={engravingToleranceParam.step}
						></Slider>
					</label>
				{/if}
			</Collapsible>
			<Collapsible value="face" title={m.dice_current_face()} defaultOpen={false}>
				<label class="mt-4 flex flex-col">
					<select
						class="select"
						value={faceSelectValue}
						onchange={(e) => {
							const v = (e.target as HTMLSelectElement).value;
							if (v === 'none') {
								selectMode = 'none';
								selectedFaces = [];
							} else if (v === 'multi') {
								// seed the multi selection with the current single face, if any.
								if (selectMode !== 'multi') {
									selectedFaces =
										selectMode === 'single' && selectedFace >= 0 ? [selectedFace] : [];
								}
								selectMode = 'multi';
							} else {
								selectMode = 'single';
								selectedFaces = [];
								selectedFace = Number(v);
								onChangeSelectedFace?.(selectedFace);
							}
						}}
					>
						<option value="none">{m.face_select_none()}</option>
						<option value="multi">{m.face_select_multi()}</option>
						{#each visibleFaces as { face, i } (i)}
							<option value={String(i)}>{faceName(face, i)}</option>
						{/each}
					</select>
				</label>
				{#if selectMode === 'multi'}
					<div class="mt-2 flex items-center justify-end gap-2 text-sm">
						<button
							type="button"
							class="anchor"
							onclick={() => {
								selectedFaces = visibleFaces.map(({ i }) => i);
							}}>{m.face_select_all()}</button
						>
						<span>/</span>
						<button
							type="button"
							class="anchor"
							onclick={() => {
								selectedFaces = [];
							}}>{m.face_select_clear()}</button
						>
					</div>
					<div class="border-surface-300-700 mt-1 max-h-32 overflow-y-auto rounded border">
						{#each visibleFaces as { face, i } (i)}
							<label class="hover:bg-surface-200-800 flex items-center gap-2 px-2 py-1">
								<input
									type="checkbox"
									class="checkbox"
									checked={selectedFaces.includes(i)}
									onchange={(e) => {
										const checked = (e.target as HTMLInputElement).checked;
										const set = new Set(selectedFaces);
										if (checked) {
											set.add(i);
											selectedFace = i;
											onChangeSelectedFace?.(i);
										} else {
											set.delete(i);
										}
										// staying in multi mode even when 0 or 1 remain selected.
										selectedFaces = [...set].sort((a, b) => a - b);
									}}
								/>
								<span>{faceName(face, i)}</span>
							</label>
						{/each}
					</div>
				{/if}
				{#if targetFaces.length > 0}
					<!-- 
	face params are specific:
	
	legend
	scale: 0-2
	rotation: -Pi - Pi
	extraDepth: -3-3 // per-face engraving depth offset (mm)
	offset Vector2 (i.e. x,y) from center. might be better to have a component for this
	that we bind to the faceparams
	
	-->
					{#if selectMode === 'multi'}
						<button
							type="button"
							class="btn preset-tonal-primary my-2 w-full justify-start"
							onclick={() => onSyncFaces?.()}>{m.face_parameters_sync()}</button
						>
					{/if}
					<label class="my-2 flex items-center justify-between">
						{m.face_parameters_selected_legend()}
						<Modal>
							{#snippet title()}
								{m.face_parameters_pick_legend()}
							{/snippet}
							{#snippet trigger(props)}
								<button {...props} class="btn preset-filled-primary-500 p-0">
									<LegendPreview {legends} legend={faceLegend} class="size-12" />
								</button>
							{/snippet}
							{#snippet inner(close)}
								{#if onEditLegends}
									<div class="mb-2 flex justify-end">
										<button
											type="button"
											class="btn btn-sm preset-tonal-secondary"
											onclick={() => {
												close();
												onEditLegends?.();
											}}
										>
											<Pencil class="size-4" />
											{isBuiltin(legends.id)
												? m.legends_clone_builtin_edit()
												: m.legends_edit_legends()}
										</button>
									</div>
								{/if}
								<LegendViewer
									{legends}
									selectedLegend={faceLegend}
									onSelectedLegend={(next) => {
										setFaceLegend(next);
										close();
									}}
								/>
							{/snippet}
						</Modal>
					</label>
					{#if paramMode === 'raw'}
						<div class="mt-2 flex flex-col gap-3">
							{#each faceRawFields as field (field.id)}
								<div class="flex flex-col gap-1">
									<p class="flex items-center justify-between gap-2">
										<span class="truncate">{field.label()}</span>
										{#if field.showUnset}
											<label class="flex shrink-0 items-center gap-1 text-xs">
												<input
													type="checkbox"
													class="checkbox"
													checked={!faceFieldIsSet(field.unsetField)}
													onchange={(e) =>
														setFaceFieldUnset(
															field.unsetField,
															(e.target as HTMLInputElement).checked
														)}
												/>
												{m.dice_parameters_raw_unset()}
											</label>
										{/if}
									</p>
									<input
										type="text"
										inputmode="decimal"
										class="input {faceOutOfRange(field.id, rawFaceValue(field.id), field.min, field.max)
											? 'border-warning-500'
											: ''}"
										value={rawFaceValue(field.id)}
										disabled={!faceFieldIsSet(field.unsetField)}
										oninput={(e) => setRawFace(field.id, (e.target as HTMLInputElement).value)}
									/>
									<span class="text-surface-500 text-xs">
										{m.dice_parameters_raw_range({
											min: field.min,
											max: field.max,
											step: field.step
										})}
									</span>
								</div>
							{/each}
						</div>
					{:else}
						<label class="flex flex-col">
							<p class="flex justify-between">
								<span>
									{m.face_parameters_scale()}
								</span>
								<span>
									({numberFormat(faceLegendScale)})
								</span>
							</p>

							<Slider
								class="py-1"
								value={faceLegendScale}
								onChange={(nextScale) => {
									updateTargetFaces((p) => (p.scale = nextScale));
								}}
								min={0.1}
								max={5.0}
								step={0.01}
							></Slider>
						</label>
						<label class="flex flex-col">
							<p class="flex justify-between">
								<span>
									{m.face_parameters_offset_x()}
								</span>
								<span>
									({faceLegendOffset.x.toFixed(2)})
								</span>
							</p>
							<Slider
								class="py-1"
								value={faceLegendOffset.x}
								onChange={(nextOffset) => {
									updateTargetFaces((p) => {
										p.offset = (p.offset?.clone() ?? new Vector2(0, 0)).setX(nextOffset);
									});
								}}
								min={-20}
								max={20}
								step={0.1}
							></Slider>
						</label>
						<label class="flex flex-col">
							<p class="flex justify-between">
								<span>
									{m.face_parameters_offset_y()}
								</span>
								<span>
									({faceLegendOffset.y.toFixed(2)})
								</span>
							</p>
							<Slider
								class="py-1"
								value={faceLegendOffset.y}
								onChange={(nextOffset) => {
									updateTargetFaces((p) => {
										p.offset = (p.offset?.clone() ?? new Vector2(0, 0)).setY(nextOffset);
									});
								}}
								min={-20}
								max={20}
								step={0.1}
							></Slider>
						</label>
						<label class="flex flex-col">
							<p class="flex justify-between">
								<span>
									{m.face_parameters_rotation()}
								</span>
								<span>
									({faceRotationDegrees.toFixed(2)})
								</span>
							</p>
							<Slider
								class="py-1"
								value={faceRotationDegrees}
								onChange={(nextRotation) => {
									updateTargetFaces((p) => (p.rotation = degToRad(nextRotation)));
								}}
								min={-180}
								max={180}
								step={0.1}
							></Slider>
						</label>
						<label class="flex flex-col">
							<p class="flex justify-between">
								<span class="flex items-center gap-1">
									{m.face_parameters_extra_depth()}
									{@render helpIcon(m.face_parameters_extra_depth_description())}
								</span>
								<span>
									({numberFormat(faceExtraDepth)})
								</span>
							</p>
							<Slider
								class="py-1"
								value={faceExtraDepth}
								onChange={(nextExtraDepth) => {
									updateTargetFaces((p) => (p.extraDepth = nextExtraDepth));
								}}
								min={-3}
								max={3}
								step={0.05}
							></Slider>
						</label>
					{/if}
				{/if}
				{#if displayFace >= 0}
					<div class="mt-4 flex flex-col gap-2">
						<button
							type="button"
							class="btn preset-tonal-primary justify-start"
							onclick={() => onApplyToAll?.()}>{m.format_painter_apply_all()}</button
						>
						<button
							type="button"
							class="btn preset-tonal-primary justify-start"
							onclick={() => onEnterFormatPaint?.()}>{m.format_painter_enter()}</button
						>
					</div>
				{/if}
			</Collapsible>
		</CollapsibleGroup>
	{/if}
</div>

<!-- interstitial: leaving the custom ordering drops the hand-edited legends.
     rendered as a controlled overlay (the shared Modal is trigger-based, but
     this opens programmatically from the ordering <select>). -->
{#if pendingOrdering !== null}
	<div class="bg-surface-50-950/50 fixed inset-0 z-50 flex items-center justify-center p-4">
		<div class="card bg-surface-100-900 max-w-sm space-y-4 p-4 shadow-xl">
			<h3 class="text-lg font-bold">{m.legend_ordering_reset_title()}</h3>
			<p>{m.legend_ordering_reset_body()}</p>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="btn preset-tonal-surface"
					onclick={() => (pendingOrdering = null)}
				>
					{m.legend_ordering_reset_cancel()}
				</button>
				<button
					type="button"
					class="btn preset-filled-primary-500"
					onclick={() => {
						const id = pendingOrdering;
						pendingOrdering = null;
						if (id !== null) {
							switchOrdering(id);
						}
					}}
				>
					{m.legend_ordering_reset_confirm()}
				</button>
			</div>
		</div>
	</div>
{/if}
