<script lang="ts">
	import dice from '$lib/dice';
	import fonts from '$lib/fonts';
	import type { FaceParams } from '$lib/interfaces/dice';
	import { findAllBadTriangles } from '$lib/utils/bad_edges';
	import { Builder } from '$lib/utils/builder';
	import { blanks, debugLegendName, Legend, type LegendSet } from '$lib/utils/legends';
	import { createBaseSceneAndRenderer } from '$lib/utils/scene';
	import { Group, Mesh, MeshBasicMaterial, MeshNormalMaterial, type Object3D } from 'three';

	const _blanks = blanks();
	//
	// Load a font.
	// Create all the "legends" by extracting the shapes for each one.
	// Engrave the shapes on to squares and  put the squares in a scene
	//
	let canvas: HTMLElement;
	let scene: ReturnType<typeof createBaseSceneAndRenderer>;
	let legends: LegendSet = fonts.siamese_katsong;

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

	let builders = Array.from({ length: Legend.CUSTOM_SYMBOLS_START + 1 }).map((_, i) => {
		const builder = new Builder(dice.cube_d6, _blanks);
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
			builder.build({ size: 16 }, params);
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
	});

	function renderAllLegends() {
		builders.forEach((fn) => fn(legends));
	}
	renderAllLegends();

	function switchTo(set: LegendSet): () => void {
		return () => {
			legends = set;
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

	$effect(() => {
		if (canvas) {
			scene = createBaseSceneAndRenderer(canvas);
			scene.scene.add(...renders);
			scene.scene.add(badGroup);
			scene.render();
		}
	});

	async function filePicked(
		ev: Event & {
			currentTarget: EventTarget & HTMLInputElement;
		}
	) {
		const [buf, fontMod] = await Promise.all([
			ev.currentTarget.files?.[0]?.arrayBuffer(),
			import('$lib/utils/font'),
		]);
		if (buf) {
			const set = fontMod.createSetFromFont(buf);
			legends = set;
			renderAllLegends();
		}
	}
</script>

<div>
	<div class="cvs" bind:this={canvas}></div>
	<p><button onclick={toggleWireframe}>toggle wireframes</button></p>
	<p><button onclick={toggleMain}>toggle bad triangles only</button></p>
	<p>Pick a font</p>
	<ul>
		<li><button onclick={switchTo(fonts.siamese_katsong)}>Siamese Katsong</button></li>
		<li><button onclick={switchTo(fonts.alice_in_wonderland)}>Alice In Wonderland</button></li>
		<li><button onclick={switchTo(fonts.averia)}>Averia</button></li>
		<li><button onclick={switchTo(fonts.germania_one)}>Germania One</button></li>
		<li><button onclick={switchTo(fonts.tektur)}>Tektur</button></li>
		<li><button onclick={switchTo(fonts.voltaire)}>Voltaire</button></li>
	</ul>
	<h2>Upload a font</h2>
	<p><input onchange={filePicked} type="file" /></p>
</div>

<style>
	.cvs {
		width: 100%;
		height: 768px;
	}
</style>
