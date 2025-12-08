<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DiceParameters from '$lib/components/dice_parameters/DiceParameters.svelte';
	import DiePreview from '$lib/components/die_preview/DiePreview.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import type { MenuItem } from '$lib/components/menu/menu';
	import Menu from '$lib/components/menu/Menu.svelte';
	import Scene from '$lib/components/scene/Scene.svelte';
	import dice from '$lib/dice';
	import builtins, { type Builtin } from '$lib/fonts';
	import { waitForSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Builder } from '$lib/utils/builder';
	import { hoverAndClickEvents } from '$lib/utils/events';
	import { createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { event } from '$lib/utils/use_event';
	import {
		Box,
		FileBoxIcon,
		FileCode2,
		FileType,
		Focus,
		Grid3X3,
		LayoutGrid,
		PlusIcon,
		XIcon
	} from '@lucide/svelte';
	import { Button } from 'bits-ui';
	import { onMount } from 'svelte';
	import { Vector3 } from 'three';

	let { setId = '' } = page.params;
	let dieId = $derived(page.url.searchParams.get('die') ?? '');
	let renderPass = $state(0);

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
		} else {
			goto('/');
		}
		loaded = true;
		console.log(setData);
	});

	let ctx = $state<SceneRenderer>();

	// we will override this after capturing the initial state.
	// svelte-ignore non_reactive_update
	let resetCamera = () => {};

	const camInitialPos = new Vector3(0, 10, 40);

	$effect(() => {
		if (explodeMode) {
			camInitialPos.set(0, 0, 100);
			if (ctx) {
				ctx.controls.noRotate = true;
			}
		} else {
			camInitialPos.set(0, 10, 40);
			if (ctx) {
				ctx.controls.noRotate = false;
			}
		}
	});

	const sceneReady = (_ctx: SceneRenderer) => {
		// this is only called on Scene mount, and not reactive
		// use it to set up the scene window, but not
		// to use the reactiveProps directly.
		ctx = _ctx;
		ctx.camera.position.copy(camInitialPos);
		const camZoom = ctx.camera.zoom;
		const camRot = ctx.camera.rotation.clone();
		resetCamera = () => {
			_ctx.controls.reset();
			_ctx.camera.position.copy(camInitialPos);
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
		if (!explodeMode) {
			const face = currentBuilder?.getFaces()[idx];
			const camera = ctx?.camera;
			if (camera && face) {
				face.transform?.applyRotationToCamera(camera); // we should get the model to do this work.
				ctx?.controls.update();
			}
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
					renderPass = builder.build({ ...d.parameters }, d.face_parameters.slice());
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
					currentBuilder?.changeLegends(setData!.legends);
					renderPass = builder.build({ ...d.parameters }, d.face_parameters.slice());
					console.log(
						JSON.stringify(d.face_parameters, (key, value) => {
							try {
								if (value.isVector2) {
									return `new Vector2(${value.x}, ${value.y})`;
								}
							} catch {}
							return value;
						})
					);
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
		gridVisible = !gridVisible;
	}
	$effect(() => {
		const show = gridVisible && !explodeMode;
		if (!show) {
			ctx?.scene.remove(gridHelper);
		} else {
			ctx?.scene.add(gridHelper);
		}
	});

	let selectedFace = $state(0);

	$effect(() => {
		//highlightFaces();
		highlightSelectedFace();
	});

	function highlightSelectedFace() {
		ctx?.setPrimarySelectedItems(currentBuilder?.getOutlineObjects(selectedFace) ?? []);
	}

	let explodeMode = $state(false);

	// The explode mode explodes the dice into a flat grid of faces.
	// I want that to be animated!
	// so I need to tween between the standard state for each face group and the
	// desired flat position of the group. this is a matter of "reserving" the orientation
	// for each face group and adding the translation and then tweening between the current orientation(rotation)
	// and position. The position is easy..., tween x,y,z independently. but the rotation is a bit more complex.
	// perhaps I should split the "face.orient" method into a rotation and translation prop.
	// then I have the "rotation from flat" and translation from origin, which should allow
	// me to reverse the props.
	// unfortunately I modelled the orientation as an imperative function which translates and rotates...

	function fontAction(b: Builtin) {
		return async () => {
			const fnt = await b.load();
			if (setData) {
				setData.legends = fnt;
			}
		};
	}

	const legendsMenu: MenuItem[] = [
		{
			title: m.menu_all_blanks(),
			type: 'action',
			icon: FileType,
			action: fontAction(builtins.blanks)
		},
		{
			title: m.menu_standard(),
			type: 'submenu',
			children: Object.values(builtins)
				.filter((x) => x.tags.includes('std'))
				.map((f) => {
					return {
						title: f.name,
						type: 'action',
						icon: FileType,
						action: fontAction(f)
					};
				})
		},
		{
			title: m.menu_numbers_0_99(),
			type: 'submenu',
			children: Object.values(builtins)
				.filter((x) => x.tags.includes('0-99'))
				.map((f) => {
					return {
						title: f.name,
						type: 'action',
						icon: FileType,
						action: fontAction(f)
					};
				})
		}
	];
</script>

<Layout title={setData?.name ?? ''}>
	{#snippet header()}
		<Menu
			data={{
				[m.menu_legends()]: legendsMenu,

				[m.menu_export()]: [
					{
						title: m.menu_export_as_json(),
						icon: FileCode2,
						type: 'action',
						action: () => {
							console.log('JSON');
						}
					},
					{
						title: m.menu_export_as_stl(),
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
		<div class="flex flex-row flex-wrap items-center justify-start gap-4 pb-4">
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
				title={m.controls_add_new_die()}
			>
				<PlusIcon size={32} />
			</button>
		</div>
		<Scene class="relative w-full grow" {sceneReady}>
			<ul class="list-style-type-none absolute top-2 left-2 flex flex-col gap-2">
				<li>
					<Button.Root
						class="btn-icon preset-filled-primary-500"
						title={m.controls_reset_camera()}
						onclick={() => {
							lookAtFace(selectedFace);
						}}><Focus /></Button.Root
					>
				</li>
				<li>
					<Button.Root
						class="btn-icon preset-filled-primary-500"
						title={m.controls_toggle_gridlines()}
						onclick={() => {
							toggleGridHelper();
						}}><Grid3X3 /></Button.Root
					>
				</li>
				<li>
					<Button.Root
						class="btn-icon preset-filled-primary-500"
						title={m.controls_toggle_explode_mode()}
						onclick={() => {
							explodeMode = !explodeMode;
							if (explodeMode) {
								setTimeout(() => {
									resetCamera();
								});
							}
						}}
						>{#if explodeMode}<Box />{:else}<LayoutGrid />{/if}</Button.Root
					>
				</li>
			</ul>
			<div class="absolute top-2 right-2 flex flex-col">
				{#if setData && currentBuilder}
					{@const die = setData.dice!.find((x) => x.id === dieId)}
					{#if die}
						<DiceParameters
							{renderPass}
							bind:dparams={die.parameters}
							bind:fparams={die.face_parameters}
							kind={die.kind}
							builder={currentBuilder}
							legends={setData.legends}
							bind:selectedFace
							onChangeSelectedFace={(f) => lookAtFace(f)}
						/>
					{/if}
				{/if}
			</div>
		</Scene>
	</div></Layout
>
