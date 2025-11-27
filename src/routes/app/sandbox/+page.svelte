<script lang="ts">
	import AppBar from '$lib/components/app_bar/AppBar.svelte';

	import dice from '$lib/dice/index';
	import type { FaceParams } from '$lib/interfaces/dice';
	import { findAllBadTriangles } from '$lib/utils/bad_edges';
	import { Builder } from '$lib/utils/builder';
	import fonts, { blanks, type Builtin } from '$lib/fonts';
	import {
		createBaseSceneAndRenderer,
		createGridHelper,
		type SceneRenderer
	} from '$lib/utils/scene';
	import { AxesHelper, DoubleSide, MeshBasicMaterial, MeshNormalMaterial, Vector2 } from 'three';
	import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
	import { hoverAndClickEvents } from '$lib/utils/events';
	import { Legend, type LegendSet } from '$lib/utils/legends';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';

	const builder = new Builder(dice.cube_d6, blanks);

	function time<R>(msg: string, fn: () => R): R {
		const before = Date.now();
		const out = fn();
		console.log(msg, Date.now() - before);
		return out;
	}
	const dieParams: Record<string, number> = {
		polyhedron_size: 16,
		crystal_twist: 0
	};
	const legend = undefined as Legend | undefined; // Legend.CUSTOM_SYMBOLS_START + 7;

	const faceParams: Array<FaceParams> = [
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend },
		{ legend }
	];

	const changeFont = (f: Builtin) => {
		f.load().then((ff) => {
			builder.changeLegends(ff);
			builder.build(dieParams, faceParams);
		});
	};
	changeFont(fonts.alice_in_wonderland_100);

	function downloadSTL() {
		const exporter = new STLExporter();
		const out = time('detail render', () => builder.export(dieParams, faceParams));
		time('find bad after render', () => findAllBadTriangles(out));
		const data = exporter.parse(out, { binary: true });
		const link = document.createElement('a');
		link.download = 'test.stl';
		link.href = URL.createObjectURL(new Blob([data as any], { type: 'model/stl' }));
		link.style.display = 'none';
		document.body.appendChild(link);
		link.click();
	}

	const gridHelper = createGridHelper(60);
	let showGridHelper = false;
	let scene: SceneRenderer;

	function toggleGrid() {
		showGridHelper = !showGridHelper;
		if (scene) {
			if (showGridHelper) {
				scene.scene.add(gridHelper);
			} else {
				scene.scene.remove(gridHelper);
			}
		}
	}
	let showMain = false;
	function toggleMain() {
		showMain = !showMain;
		if (scene) {
			if (showMain) {
				scene.scene.add(merged);
			} else {
				scene.scene.remove(merged);
			}
		}
	}

	let showBad = false;
	function toggleBad() {
		showBad = !showBad;
		if (scene && bad) {
			if (showBad) {
				scene.scene.add(bad);
			} else {
				scene.scene.remove(bad);
			}
		}
	}

	let showWireframe = false;
	const m1 = new MeshNormalMaterial({ wireframe: showWireframe, side: DoubleSide });
	const m2 = new MeshBasicMaterial({ color: 0x444444, wireframe: showWireframe });
	function toggleWireframe() {
		showWireframe = !showWireframe;
		m1.wireframe = showWireframe;
		m1.needsUpdate = true;
		m2.wireframe = showWireframe;
		m2.needsUpdate = true;
	}
	builder.setFrontMaterial(m1);
	builder.setWallMaterial(m1);
	builder.setEngravedMaterial(m2);

	time('building mesh took', () => builder.build(dieParams, faceParams));
	const merged = builder.diceGroup;
	const bad = time('calculating bad triangles', () => findAllBadTriangles(merged));

	let hoverFace = -1;

	let onSceneReady = (ctx: SceneRenderer) => {
		scene = ctx;
		const axesHelper = new AxesHelper(50);
		scene.scene.add(axesHelper);

		scene.camera.position.set(0, 10, 30);
		scene.camera.zoom = 1.5;

		toggleGrid();
		toggleMain();
		scene.render();

		hoverAndClickEvents(scene.renderer.domElement, scene.camera, merged, (ev) => {
			if (ev.face !== hoverFace) {
				scene.setSecondarySeletedItems(builder.getOutlineObjects(ev.face) ?? []);
			}
		});
	};
</script>

<Layout>
	<div class="flex h-full flex-col">
		<Scene class="w-full grow" sceneReady={onSceneReady} />
		<div class="flex flex-row gap-8 p-8">
			<p>
				<button class="btn preset-filled-primary-500" onclick={downloadSTL}>download stl</button>
			</p>
			<p><button class="btn preset-filled-primary-500" onclick={toggleGrid}>toggle grid</button></p>
			<p><button class="btn preset-filled-primary-500" onclick={toggleMain}>toggle main</button></p>
			<p><button class="btn preset-filled-primary-500" onclick={toggleBad}>toggle bad</button></p>
			<p>
				<button class="btn preset-filled-primary-500" onclick={toggleWireframe}
					>toggle wireframe</button
				>
			</p>
			<p>
				<select onchange={(ev) => changeFont(fonts[ev.currentTarget.value as keyof typeof fonts])}>
					{#each Object.entries(fonts) as [k, v]}
						<option value={k}>{v.name}</option>
					{/each}
				</select>
			</p>
		</div>
	</div>
</Layout>
