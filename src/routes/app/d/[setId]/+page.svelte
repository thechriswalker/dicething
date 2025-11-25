<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DiePreview from '$lib/components/die_preview/DiePreview.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Menu from '$lib/components/menu/Menu.svelte';
	import Scene from '$lib/components/scene/Scene.svelte';
	import dice from '$lib/dice';
	import { dieToJSON, waitForSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Builder, engravingParam } from '$lib/utils/builder';
	import { hoverAndClickEvents } from '$lib/utils/events';
	import { debugLegendName, Legend } from '$lib/utils/legends';
	import { createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { event } from '$lib/utils/use_event';
	import {
		FileBoxIcon,
		FileCode2,
		FileType,
		Focus,
		Grid3X3,
		PlusIcon,
		Settings,
		XIcon
	} from '@lucide/svelte';
	import { Slider } from '@skeletonlabs/skeleton-svelte';
	import { Button } from 'bits-ui';
	import { onMount } from 'svelte';
	import { Object3D, Vector2, Vector3 } from 'three';
	import { degToRad, radToDeg } from 'three/src/math/MathUtils.js';

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
		const camPos = new Vector3(0, 10, 40);
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

	$effect(() => {
		if (ctx && currentBuilder) {
			return hoverAndClickEvents(
				ctx.renderer.domElement,
				ctx.camera,
				currentBuilder.diceGroup,
				(ev) => {
					ctx?.setSecondarySeletedItems(currentBuilder?.getOutlineObjects(ev.face) ?? []);
				},
				(ev) => {
					if (ev.dice === dieId) {
						if (selectedFace !== ev.face) {
							selectedFace = ev.face;
							lookAtFace(selectedFace);
						}
					}
				}
			);
		}
	});

	function lookAtFace(idx: number) {
		console.log('looking at face:', idx);
		resetCamera();
		const face = currentBuilder?.getFaces()[idx];
		const camera = ctx?.camera;
		if (camera && face) {
			face.pointCamera?.(camera); // we should get the model to do this work.
			ctx?.controls.update();
		}
	}

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
	let approxVolume = $state<string | number>('-');
	let currentBuilder = $state<Builder | undefined>(undefined);

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
					approxVolume = builder.getApproximateVolume();
					ctx.scene.add(builder.diceGroup);
					renderedDice = d.id;
					currentBuilder = builder;
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
				currentBuilder = undefined;
			} else {
				if (dieId !== renderedDice && ctx) {
					const builder = diceBuilders.get(renderedDice);
					if (builder) {
						ctx.scene.remove(builder.diceGroup);
					}
					renderedDice = '';
					currentBuilder = undefined;
				}
				const builder = diceBuilders.get(dieId);
				if (builder && ctx) {
					const d = setData?.dice.find((x) => x.id === dieId)!;
					console.log('rendering on change', dieId, ctx.scene);
					builder.build({ ...d.parameters }, d.face_parameters.slice());
					console.log(dieToJSON(d));
					face2face = builder.getFace2FaceDistance();
					approxVolume = builder.getApproximateVolume();
					const updated = dieId != renderedDice;
					renderedDice = dieId;
					currentBuilder = builder;
					if (updated) {
						selectedFace = 0;
						console.log('dice changed');
						resetCamera();
						ctx.scene.add(builder.diceGroup);
					}
					setTimeout(() => highlightSelectedFace());
				}
			}
		}
	});

	const gridHelper = createGridHelper(50);
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
	let selectedFace = $state(0);

	$effect(() => {
		//highlightFaces();
		highlightSelectedFace();
	});

	function highlightSelectedFace() {
		ctx?.setPrimarySelectedItems(currentBuilder?.getOutlineObjects(selectedFace) ?? []);
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
					class={'transition-duration-100 hover:border-primary-500 group hover:shadow-primary-500 relative size-16 cursor-pointer rounded-md border transition-transform ease-in-out hover:scale-120 hover:shadow-md ' +
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
							lookAtFace(selectedFace);
						}}><Focus /></Button.Root
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
						{@const faces = currentBuilder?.getFaces()}
						{@const firstBlank = faces?.findIndex((x) => !x.isNumberFace) ?? -1}
						<div class="card preset-tonal-surface w-72 p-4">
							<p class="preset-typo-subtitle text-center">{m['dice.name']({ kind: die.kind })}</p>
							<p>
								Approximate Volume: {numberFormat(approxVolume)}
							</p>
							{#if params.every((x) => x.id !== 'polyhedron_size')}
								<p>
									{m['dice_parameters.face_to_face_distance']()}: {numberFormat(face2face)}
								</p>
							{/if}
							{#each params as p}
								{@const currentValue = die.parameters[p.id] ?? p.defaultValue}
								<label
									id="parameter-{p.id}"
									class="flex flex-col"
									title={m['dice_parameters.description']({ id: p.id })}
								>
									{m['dice_parameters.name']({ id: p.id })}: ({currentValue}):
									<!-- Bits UI Slider component! -->

									<Slider
										classes="py-2 my-2 "
										meterBg="bg-primary-500"
										thumbBg="bg-primary-500"
										value={[currentValue]}
										onValueChange={(e) => (die.parameters[p.id] = e.value[0])}
										min={p.min}
										max={p.max}
										step={p.step}
									></Slider>
								</label>
							{/each}
							<label
								id="parameter-{engravingParam.id}"
								class="flex flex-col"
								title={m['dice_parameters.description']({ id: engravingParam.id })}
							>
								{m['dice_parameters.name']({ id: engravingParam.id })}: ({die.parameters[
									engravingParam.id
								] ?? engravingParam.defaultValue}):
								<!-- Bits UI Slider component! -->

								<Slider
									classes="py-2 my-2 "
									meterBg="bg-primary-500"
									thumbBg="bg-primary-500"
									value={[die.parameters[engravingParam.id] ?? engravingParam.defaultValue]}
									onValueChange={(e) => (die.parameters[engravingParam.id] = e.value[0])}
									min={engravingParam.min}
									max={engravingParam.max}
									step={engravingParam.step}
								></Slider>
							</label>
							<label class="mt-4 flex flex-col">
								<p class="preset-typo-subtitle text-center">{m['dice.current_face']()}</p>
								<select
									class="select"
									onchange={(e) => {
										selectedFace = Number((e.target as any).value);
										if (selectedFace !== -1) {
											lookAtFace(selectedFace);
										}
									}}
								>
									<option value={-1}>-</option>
									{#each currentBuilder?.getFaces() as face, i}
										{#if face.isNumberFace}
											<option value={i} selected={i === selectedFace}>Face {i + 1}</option>
										{:else}
											<option value={i} selected={i === selectedFace}
												>Blank {i + 1 - firstBlank}</option
											>
										{/if}
									{/each}
								</select>
							</label>
							{#if selectedFace !== -1}
								<!-- 
								face params are specific:

								legend
								scale: 0-2
								rotation: -Pi - Pi
								extraDepth: 0-1 // for engraving
								offset Vector2 (i.e. x,y) from center. might be better to have a component for this
								that we bind to the faceparams
						
							-->
								<label class="flex flex-col">
									<!-- >{
									//m['face_params.legend']()
									} -->
									Legend
									<select
										onchange={(e) => {
											//
											const nextLegend = (e.target as any).value as Legend;
											const params = die.face_parameters[selectedFace] ?? {};
											params.legend = nextLegend;
											die.face_parameters[selectedFace] = params;
										}}
									>
										<option value={Legend.BLANK}>BLANK</option>
										{#each setData.legends as l}
											<option
												value={l}
												selected={l ===
													(die.face_parameters[selectedFace]?.legend ??
														currentBuilder?.getFaces()[selectedFace]?.defaultLegend)}
												>{debugLegendName(l)}</option
											>
										{/each}
									</select>
								</label>
								<label class="flex flex-col"
									>scale ({die.face_parameters[selectedFace]?.scale ??
										currentBuilder?.currentLegendScaling ??
										1})
									<Slider
										classes="py-2 my-2 "
										meterBg="bg-primary-500"
										thumbBg="bg-primary-500"
										value={[
											die.face_parameters[selectedFace]?.scale ??
												currentBuilder?.currentLegendScaling ??
												1
										]}
										onValueChange={(e) => {
											const nextScale = e.value[0];
											const params = die.face_parameters[selectedFace] ?? {};
											params.scale = nextScale;
											die.face_parameters[selectedFace] = params;
										}}
										min={0.1}
										max={5.0}
										step={0.01}
									></Slider>
								</label>
								<label class="flex flex-col"
									>offset-x ({(
										die.face_parameters[selectedFace]?.offset ?? new Vector2(0, 0)
									).x.toFixed(2)})
									<Slider
										classes="py-2 my-2 "
										meterBg="bg-primary-500"
										thumbBg="bg-primary-500"
										value={[(die.face_parameters[selectedFace]?.offset ?? new Vector2(0, 0)).x]}
										onValueChange={(e) => {
											const nextOffset = e.value[0];
											const params = die.face_parameters[selectedFace] ?? {};
											if (params.offset) {
												params.offset = params.offset.clone().setX(nextOffset);
											} else {
												params.offset = new Vector2(nextOffset, 0);
											}
											die.face_parameters[selectedFace] = params;
										}}
										min={-20}
										max={20}
										step={0.1}
									></Slider>
								</label>
							{/if}
							<label class="flex flex-col"
								>offset-y ({(
									die.face_parameters[selectedFace]?.offset ?? new Vector2(0, 0)
								).y.toFixed(2)})
								<Slider
									classes="py-2 my-2 "
									meterBg="bg-primary-500"
									thumbBg="bg-primary-500"
									value={[(die.face_parameters[selectedFace]?.offset ?? new Vector2(0, 0)).y]}
									onValueChange={(e) => {
										const nextOffset = e.value[0];
										const params = die.face_parameters[selectedFace] ?? {};
										if (params.offset) {
											params.offset = params.offset.clone().setY(nextOffset);
										} else {
											params.offset = new Vector2(0, nextOffset);
										}
										die.face_parameters[selectedFace] = params;
									}}
									min={-20}
									max={20}
									step={0.1}
								></Slider>
							</label>
							<label class="flex flex-col"
								>rotation ({radToDeg(die.face_parameters[selectedFace]?.rotation ?? 0).toFixed(2)})
								<Slider
									classes="py-2 my-2 "
									meterBg="bg-primary-500"
									thumbBg="bg-primary-500"
									value={[radToDeg(die.face_parameters[selectedFace]?.rotation ?? 0)]}
									onValueChange={(e) => {
										const nextOffset = e.value[0];
										const params = die.face_parameters[selectedFace] ?? {};
										params.rotation = degToRad(nextOffset);
										die.face_parameters[selectedFace] = params;
									}}
									min={-180}
									max={180}
									step={0.1}
								></Slider>
							</label>
						</div>
					{/if}
				{/if}
			</div>
		</Scene>
	</div></Layout
>
