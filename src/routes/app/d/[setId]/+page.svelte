<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DiePreview from '$lib/components/die_preview/DiePreview.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Menu from '$lib/components/menu/Menu.svelte';
	import Scene from '$lib/components/scene/Scene.svelte';
	import dice from '$lib/dice';
	import type { DiceParameter } from '$lib/interfaces/dice';
	import { waitForSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Builder } from '$lib/utils/builder';
	import { createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { event } from '$lib/utils/use_event';
	import {
		FileBoxIcon,
		FileCode2,
		FileType,
		Grid3X3,
		MonitorUp,
		PlusIcon,
		Settings,
		XIcon
	} from '@lucide/svelte';
	import { Button } from 'bits-ui';
	import { onMount } from 'svelte';
	import { Vector3 } from 'three';

	let { setId } = page.params;
	let dieId = $derived(page.url.searchParams.get('die') ?? '');

	function gotoDie(id: string) {
		const p = page.url;
		if (id) {
			p.searchParams.set('die', id);
		} else {
			p.searchParams.delete('die');
		}
		goto(p.href);
	}

	let removeDie = (id: string) => {
		if (setData) {
			const idx = setData.dice.findIndex((x) => x.id === id);
			setData.dice.splice(idx, 1);
			if (renderedDice === id) {
				const g = diceBuilders.get(id)?.diceGroup;
				if (g) {
					ctx?.scene.remove(g);
					diceBuilders.delete(id);
				}
				gotoDie(setData?.dice[0]?.id ?? '');
			} else {
				diceBuilders.delete(id);
			}
		}
	};

	// need to load the set by id, or 404 if it doesn't exist.
	let setData: DiceSet | undefined = $state(undefined);
	let loaded = $state(false);
	onMount(async () => {
		setData = await waitForSet(setId);
		if (setData) {
			if (setData.dice.length === 0 && dieId !== '') {
				gotoDie('');
			} else if (setData.dice.length > 0 && setData.dice.findIndex((d) => d.id === dieId) === -1) {
				gotoDie(setData.dice[0].id);
			}
		}
		loaded = true;
		console.log(setData);
	});

	let ctx = $state<SceneRenderer>();

	// we will override this after capturing the initial state.
	// svelte-ignore non_reactive_update
	let resetCamera = () => {};

	const sceneReady = (_ctx: SceneRenderer) => {
		// this is only called on Scene mount, and not reactive
		// use it to set up the scene window, but not
		// to use the reactiveProps directly.
		ctx = _ctx;
		const camPos = new Vector3(0, 20, 30);
		ctx.camera.position.copy(camPos);
		const camZoom = ctx.camera.zoom;
		const camRot = ctx.camera.rotation.clone();
		resetCamera = () => {
			_ctx.controls.reset();
			_ctx.camera.position.copy(camPos);
			_ctx.camera.zoom = camZoom;
			_ctx.camera.rotation.copy(camRot);
		};
		ctx.scene.add(gridHelper);
		ctx.render();
	};

	// we have a few things to worry about here.
	// - legends - builtin or customised. if customised, we need to save it with the set.
	// - name - user editable.
	// - dice: array of Dice.
	//   - for each die we have:
	//     - dice kind: D6, D8, etc.
	//     - dice params: size/shape, etc.
	//     - faces:
	//       - for each face we have:
	//         - params: legend id, custom offsets, etc.
	//
	// any time any of these changes we need to save the set.
	// we can however have separate URLs for sets, dice, and legends... and as long as we load the set again when we come back.
	// OR the main view is all the dice, and we have a modal for each in detail?

	// the question is how to continue and be reactive?
	// we need a builder for each die. and to sync the params from the model to the builder.
	// not sure how best to do this. the builder initialises from the model, then the params.
	// if the model changes we need a new builder, but here the model cannot change.
	// lets do the builders in a Map<id, builder> and then we can keep the map in sync with the
	// data that is the source of truth.

	const diceBuilders = new Map<string, Builder>();
	let renderedDice = $state('');
	let face2face = $state<string | number>('-');

	let init = false;
	$effect(() => {
		if (setData && ctx && !init) {
			init = true;
			console.log('init', setData);
			for (let i = 0; i < setData.dice.length; i++) {
				const d = setData.dice[i];
				let builder = diceBuilders.get(d.id);
				if (!builder) {
					const model = dice[d.kind];
					builder = new Builder(model, setData.legends, d.id);
					diceBuilders.set(d.id, builder);
				} else {
					// this doesn't actually change the legends could be a noop
					builder.changeLegends(setData.legends);
				}
				if (d.id === dieId) {
					console.log('rendering in init', d.id);
					builder.build({ ...d.parameters }, d.face_parameters.slice());
					face2face = builder.getFace2FaceDistance();
					ctx.scene.add(builder.diceGroup);
					renderedDice = d.id;
				}
			}
		}
	});
	$effect(() => {
		console.log({ init, renderedDice, dieId });
		if (init) {
			if (dieId == '') {
				let builder = diceBuilders.get(renderedDice);
				if (builder && ctx) {
					ctx.scene.remove(builder.diceGroup);
				}
				renderedDice = dieId;
			} else {
				if (dieId !== renderedDice && ctx) {
					const builder = diceBuilders.get(renderedDice);
					if (builder) {
						ctx.scene.remove(builder.diceGroup);
					}
					renderedDice = '';
				}
				const builder = diceBuilders.get(dieId);
				if (builder && ctx) {
					const d = setData?.dice.find((x) => x.id === dieId)!;
					console.log('rendering on change', dieId, ctx.scene);
					builder.build({ ...d.parameters }, d.face_parameters.slice());
					face2face = builder.getFace2FaceDistance();
					if (dieId != renderedDice) {
						resetCamera();
						ctx.scene.add(builder.diceGroup);
					}
					renderedDice = dieId;
				}
			}
		}
	});

	const gridHelper = createGridHelper(100);
	let gridVisible = $state(true);
	function toggleGridHelper() {
		if (gridVisible) {
			ctx?.scene.remove(gridHelper);
		} else {
			ctx?.scene.add(gridHelper);
		}
		gridVisible = !gridVisible;
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
</script>

<Layout title={setData?.name ?? ''}>
	{#snippet header()}
		<Menu
			data={{
				Legends: [
					{
						title: 'Load Font',
						icon: FileType,
						type: 'action',
						action: () => {
							console.log('load font');
						}
					},
					{
						title: 'Customise',
						icon: Settings,
						type: 'action',
						action: () => {
							console.log('Customise');
						}
					}
				],
				Export: [
					{
						title: 'As JSON',
						icon: FileCode2,
						type: 'action',
						action: () => {
							console.log('JSON');
						}
					},
					{
						title: 'As STL',
						icon: FileBoxIcon,
						type: 'action',
						action: () => {
							console.log('STL');
						}
					}
				]
			}}
		></Menu>
	{/snippet}
	<div class="flex h-full flex-col">
		<div class="flex flex-row items-center justify-start gap-4 pb-4">
			{#each setData?.dice as die}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
				<div
					role="button"
					class={'hover:border-primary-500 group hover:shadow-primary-500 relative size-16 cursor-pointer rounded-md border hover:shadow-md ' +
						(die.id === dieId
							? 'border-primary-500 shadow-primary-500 hover:border-primary-500 group hover:shadow-primary-500 shadow-md'
							: '')}
					onclick={() => gotoDie(die.id)}
				>
					<!-- kill button -->
					<button
						use:event={{
							name: 'click',
							handler: (e) => {
								e.stopPropagation();
								removeDie(die.id);
							}
						}}
						class="absolute top-[-8px] right-[-8px] hidden rounded-lg bg-red-500 text-white group-hover:block"
					>
						<XIcon size={16} />
					</button>
					<DiePreview {die} legends={setData?.legends!} />
				</div>
			{/each}
			<button
				class="hover:border-primary-500 hover:shadow-primary-500 flex size-16 cursor-pointer items-center justify-center overflow-hidden rounded-md border text-center hover:shadow-md"
				title="ADD_NEW_DIE"
			>
				<PlusIcon size={32} />
			</button>
		</div>
		<Scene class="relative w-full grow" {sceneReady}>
			<ul class="list-style-type-none absolute top-2 left-2 flex flex-col gap-2">
				<li>
					<Button.Root
						class="btn-icon preset-filled-primary-500"
						title="RESET_CAMERA"
						onclick={() => {
							resetCamera();
						}}><MonitorUp /></Button.Root
					>
				</li>
				<li>
					<Button.Root
						class="btn-icon preset-filled-primary-500"
						title="SHOW_GRID"
						onclick={() => {
							toggleGridHelper();
						}}><Grid3X3 /></Button.Root
					>
				</li>
			</ul>
			<div class="absolute top-2 right-2 flex flex-col">
				{#if setData}
					{@const die = setData.dice!.find((x) => x.id === dieId)}
					{#if die}
						{@const params = dice[die.kind].parameters}
						<div class="card preset-tonal-surface w-72 p-4">
							<p class="preset-typo-subtitle">{m['dice.name']({ kind: die.kind })}</p>
							{#if params.every((x) => x.id !== 'polyhedron_size')}
								<p>
									Face-to-Face distance: {numberFormat(face2face)}
								</p>
							{/if}{#each params as p}
								{@const currentValue = die.parameters[p.id] ?? p.defaultValue}
								<label
									id="parameter-{p.id}"
									class="flex flex-col"
									title={m['dice_parameters.description']({ id: p.id })}
								>
									{m['dice_parameters.name']({ id: p.id })}: ({currentValue}):
									<input
										type="range"
										min={p.min}
										max={p.max}
										defaultValue={currentValue}
										bind:value={die.parameters[p.id]}
										step={p.step}
									/>
								</label>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</Scene>
	</div></Layout
>
