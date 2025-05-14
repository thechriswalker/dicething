<script lang="ts">
	import Scene from '$lib/components/scene/Scene.svelte';
	import dice from '$lib/dice';
	import fonts, { blanks, type Builtin } from '$lib/fonts';
	import type { FaceParams } from '$lib/interfaces/dice';
	import { findAllBadTriangles } from '$lib/utils/bad_edges';
	import { Builder } from '$lib/utils/builder';
	import {
		debugLegendName,
		Legend,
		loadImmutableLegends,
		type LegendSet
	} from '$lib/utils/legends';
	import { type SceneRenderer } from '$lib/utils/scene';
	import { Group, Mesh, MeshBasicMaterial, MeshNormalMaterial, type Object3D } from 'three';

	//
	// Load a font.
	// Create all the "legends" by extracting the shapes for each one.
	// Engrave the shapes on to squares and  put the squares in a scene
	//
	let scene: SceneRenderer;
	let legends: LegendSet = blanks;

	let renders: Array<Object3D> = [];
	let bad: Array<Mesh | null> = [];
	let badGroup = new Group();

	const dSize = 16;
	const gap = 4;
	const cols = 8;
	const rows = 4;
	const w = cols * dSize + (cols - 1) * gap;
	const h = rows * dSize + (rows - 1) * gap;
	const x = (i: number) => -1 * (w / 2) + 8 + (i % cols) * (dSize + gap);
	const y = (i: number) => h / 2 - 8 - Math.floor(i / cols) * (dSize + gap);

	const material = new MeshNormalMaterial();
	const black = new MeshBasicMaterial({ color: 0x000000 });
	let wireframes = false;
	function toggleWireframe() {
		wireframes = !wireframes;
		material.wireframe = wireframes;
		black.wireframe = wireframes;
	}

	let builders = Array.from({
		length: Math.max(legends.length, Legend.CUSTOM_SYMBOLS_START) + 9
	}).map((_, i) => buildBuilder(i));

	function buildBuilder(i: number) {
		const builder = new Builder(dice.cube_d6, blanks);
		builder.setFrontMaterial(material);
		builder.setWallMaterial(material);
		builder.setEngravedMaterial(black);

		builder.diceGroup.translateX(x(i));
		builder.diceGroup.translateY(y(i));

		renders[i] = builder.diceGroup;
		const params = Array.from<FaceParams>({ length: 6 }).map((_, x) => ({
			legend: x === 1 ? i : Legend.BLANK
		}));
		const build = (nextSet: LegendSet) => {
			builder.changeLegends(nextSet);
			builder.build({ polyhedron_size: 16 }, params);
			const prev = bad[i];
			if (prev) {
				badGroup.remove(prev);
			}
			console.log('finding bad triangle for legend', debugLegendName(i));
			bad[i] = findAllBadTriangles(builder.diceGroup);
			if (bad[i]) {
				bad[i].translateX(x(i));
				bad[i].translateY(y(i));
				badGroup.add(bad[i]);
			}
		};
		return build;
	}

	let legendCount = $state(1);

	$effect(() => {
		renders.forEach((r, i) => {
			if (i < legendCount) {
				r.visible = true;
			} else {
				r.visible = false;
			}
		});
		toggleMain();
		toggleMain();
	});

	function renderAllLegends() {
		legendCount = Math.max(legends.length, Legend.CUSTOM_SYMBOLS_START) + 9;
		Array.from({ length: legendCount }).forEach((_, i) => {
			if (!builders[i]) {
				builders[i] = buildBuilder(i);
			}
			const builder = builders[i];
			builder(legends);
		});
	}
	renderAllLegends();

	function switchTo(set: Builtin): () => void {
		return async () => {
			legends = await set.load();
			renderAllLegends();
		};
	}
	let showMain = true;
	function toggleMain() {
		showMain = !showMain;
		if (scene && showMain) {
			scene.scene.add(...renders);
		} else if (scene && !showMain) {
			scene.scene.remove(...renders);
		}
	}

	let onSceneReady = (ctx: SceneRenderer) => {
		scene = ctx;
		scene.scene.add(...renders);
		scene.scene.add(badGroup);
		scene.render();
		switchTo(fonts.tektur)();
	};

	async function filePicked(
		ev: Event & {
			currentTarget: EventTarget & HTMLInputElement;
		}
	) {
		const name = ev.currentTarget.files?.[0].name!;

		const [buf, fontMod] = await Promise.all([
			ev.currentTarget.files?.[0]?.arrayBuffer(),
			import('$lib/utils/font')
		]);
		if (buf) {
			const shapes = fontMod.createShapesFromFont(buf);
			legends = loadImmutableLegends({
				id: 'temp',
				name,
				shapes
			});
			renderAllLegends();
		}
	}
</script>

<div class="flex h-full flex-col">
	<Scene class="w-full grow" sceneReady={onSceneReady} />
	<div>
		<p>
			<button class="btn preset-filled-primary-500" onclick={toggleWireframe}
				>toggle wireframes</button
			>
		</p>
		<p>
			<button class="btn preset-filled-primary-500" onclick={toggleMain}
				>toggle bad triangles only</button
			>
		</p>
		<p>Pick a font</p>
		<ul>
			{#each Object.entries(fonts) as [_, f]}
				<li>
					<button class="btn preset-filled-primary-500" onclick={switchTo(f)}>{f.name}</button>
				</li>
			{/each}
		</ul>
		<h2>Upload a font</h2>
		<p><input onchange={filePicked} type="file" /></p>
	</div>
</div>
