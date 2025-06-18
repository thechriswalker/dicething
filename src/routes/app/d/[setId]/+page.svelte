<script lang="ts">
	import { page } from '$app/state';
	import Scene from '$lib/components/scene/Scene.svelte';
	import dice from '$lib/dice';
	import { waitForSet, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { Builder } from '$lib/utils/builder';
	import type { SceneRenderer } from '$lib/utils/scene';
	import { onMount } from 'svelte';

	let { setId } = page.params;

	// need to load the set by id, or 404 if it doesn't exist.
	let setData: DiceSet | undefined = $state(undefined);
	let loaded = $state(false);
	onMount(async () => {
		setData = await waitForSet(setId);
		loaded = true;
		console.log(setData);
	});

	let ctx = $state<SceneRenderer>();

	const sceneReady = (_ctx: SceneRenderer) => {
		// this is only called on Scene mount, and not reactive
		// use it to set up the scene window, but not
		// to use the reactiveProps directly.
		ctx = _ctx;
		ctx.onBeforeRender(() => {
			//	diceBuilders.forEach((b) => {});
		});
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
					builder.diceGroup.translateX(20 + 40 * i - (setData.dice.length * 40) / 2);
					diceBuilders.set(d.id, builder);
				} else {
					// this doesn't actually change the legends could be a noop
					builder.changeLegends(setData.legends);
				}
			}
			for (let [id, builder] of diceBuilders) {
				let d = setData.dice.find((d) => d.id === id);
				if (d) {
					builder.build({ ...d.parameters }, d.face_parameters.slice());
					console.log('adding die', d);
					ctx.scene.add(builder.diceGroup);
					continue;
				}
				diceBuilders.delete(id);
				ctx.scene.remove(builder.diceGroup);
			}
		}
	});
</script>

<div class="flex h-full flex-col">
	<h2 class="h3">{setData?.name}</h2>
	<Scene class="w-full grow" {sceneReady} />
	<div>controls?</div>
</div>
