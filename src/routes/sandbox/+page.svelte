<script lang="ts">
	import dice from '$lib/dice/index';
	import type { FaceParams } from '$lib/interfaces/dice';
	import { Builder } from '$lib/utils/builder';
	import { checkMesh, type MeshCheckReport } from '$lib/utils/mesh_check';
	import fonts, { blanks } from '$lib/fonts';
	import { getSavedLegends, loadLegends as loadLegendSetById } from '$lib/interfaces/storage.svelte';
	import { createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import {
		AdditiveBlending,
		AxesHelper,
		BufferAttribute,
		BufferGeometry,
		DoubleSide,
		Group,
		LineBasicMaterial,
		LineSegments,
		Matrix4,
		Mesh,
		MeshBasicMaterial,
		MeshNormalMaterial,
		Points,
		PointsMaterial,
		type Object3D
	} from 'three';
	import { onDestroy } from 'svelte';
	import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
	import { Legend, type LegendSet } from '$lib/utils/legends';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import { toNonIndexed } from '$lib/utils/3d';

	function time<R>(msg: string, fn: () => R): R {
		const before = performance.now();
		const out = fn();
		console.log(msg, (performance.now() - before).toFixed(1), 'ms');
		return out;
	}

	// --- exploration controls --------------------------------------------------
	let selectedKind = $state<keyof typeof dice>('d6_cube');
	// a legend-set selector: either a builtin font key (e.g. 'voltaire') or a
	// custom legend set's id (a uuid). loadLegendSetById resolves both forms.
	let selectedFontKey = $state<string>('voltaire');
	// the user's local custom legend sets, kept reactive so the picker updates
	// when sets are created/edited in another tab or the legend editor.
	const customLegends = $derived(getSavedLegends());
	// which mesh to show + check: the post-export() merged/deduped geometry, or
	// the raw "working" build (the per-face preview group). lets us see whether
	// the export pipeline (mergeVertices / removeDuplicateTriangles) is what
	// introduces mesh problems.
	let meshMode = $state<'export' | 'working'>('export');
	// engrave the default numbers on every face (the common source of mesh
	// problems) vs. leave all faces blank.
	let engraveFaces = $state(true);
	let showProblems = $state(true);
	let showWireframe = $state(false);
	let showGridHelper = $state(false);
	// the structural report for the currently displayed export mesh.
	let report = $state<MeshCheckReport | undefined>(undefined);

	// --- scene / three state (non-reactive) ------------------------------------
	let scene: SceneRenderer | undefined;
	let currentLegends: LegendSet = blanks;
	// whatever is currently shown in the scene (an export Mesh or the working
	// diceGroup). kept so we can remove it on rebuild and export it on download.
	let displayed: Object3D | undefined;
	let problemGroup: Group | undefined;

	const gridHelper = createGridHelper(60);
	const dieMaterial = new MeshNormalMaterial({ wireframe: false, side: DoubleSide });
	// the problem highlight: drawn on top of everything (depthTest off) so it
	// shows through the die, and animated to pulse so it's easy to spot.
	const problemMaterial = new MeshBasicMaterial({
		color: 0xff2222,
		side: DoubleSide,
		transparent: true,
		depthTest: false,
		depthWrite: false
	});
	// bright glowing markers placed at each problem triangle's centroid - these
	// stay a constant pixel size, so even a sub-pixel sliver is findable.
	const markerMaterial = new PointsMaterial({
		color: 0xffcc33,
		size: 10,
		sizeAttenuation: false,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		blending: AdditiveBlending
	});
	// boundary / non-manifold edges drawn as bright lines on top of everything.
	// These are often the ONLY visible signal: an unsound edge has real length
	// even when there are no problem triangles to fill in.
	const edgeMaterial = new LineBasicMaterial({
		color: 0xff2222,
		transparent: true,
		depthTest: false,
		depthWrite: false
	});

	// --- pulsing-glow animation for the problem highlight ----------------------
	let pulseRAF = 0;
	const pulseStart = performance.now();
	function startPulse() {
		if (pulseRAF) {
			return;
		}
		const tick = () => {
			const t = (performance.now() - pulseStart) / 1000;
			const p = 0.5 + 0.5 * Math.sin(t * Math.PI * 3); // ~1.5 Hz, ranges 0..1
			problemMaterial.opacity = 0.35 + 0.65 * p;
			// red -> hot orange/yellow as it pulses, like a glowing ember.
			problemMaterial.color.setRGB(1, 0.1 + 0.75 * p, 0.05 * p);
			edgeMaterial.opacity = 0.5 + 0.5 * p;
			edgeMaterial.color.setRGB(1, 0.1 + 0.75 * p, 0.05 * p);
			markerMaterial.size = 7 + 13 * p;
			markerMaterial.opacity = 0.5 + 0.5 * p;
			pulseRAF = requestAnimationFrame(tick);
		};
		pulseRAF = requestAnimationFrame(tick);
	}
	function stopPulse() {
		if (pulseRAF) {
			cancelAnimationFrame(pulseRAF);
			pulseRAF = 0;
		}
	}
	onDestroy(stopPulse);

	async function loadLegends() {
		currentLegends = await loadLegendSetById(selectedFontKey);
	}

	// Empty face params => every face engraves its default legend (numbers). To
	// blank a die we need one BLANK entry per face, so build once to learn the
	// face count first.
	function buildFaceParams(model: (typeof dice)[keyof typeof dice]): Array<FaceParams> {
		if (engraveFaces) {
			return [];
		}
		const probe = new Builder(model, currentLegends);
		probe.build({}, [], { explode: false });
		return probe.getFaces().map(() => ({ legend: Legend.BLANK }));
	}

	// Gather every triangle of a (possibly nested, transformed) object into one
	// flat, world-space position buffer - the same thing checkMesh wants. Used
	// for the "working" diceGroup, whose per-face geometry is positioned by group
	// transforms rather than baked in. checkMesh welds coincident corners by
	// quantising, so the un-merged working mesh is analysed on equal footing with
	// the merged export mesh.
	function collectGroupPositions(root: Object3D): Float32Array {
		const out: Array<number> = [];
		const recur = (o: Object3D, parent: Matrix4) => {
			o.updateMatrix();
			const world = parent.clone().multiply(o.matrix);
			const mesh = o as Mesh;
			if (mesh.isMesh) {
				let g = toNonIndexed(mesh.geometry);
				if (g === mesh.geometry) {
					g = g.clone();
				}
				g.applyMatrix4(world);
				const arr = g.getAttribute('position').array;
				for (let i = 0; i < arr.length; i++) {
					out.push(arr[i]);
				}
				g.dispose();
			}
			o.children.forEach((c) => recur(c, world));
		};
		recur(root, new Matrix4().identity());
		return new Float32Array(out);
	}

	function clearDisplayed() {
		if (displayed && scene) {
			scene.scene.remove(displayed);
		}
		displayed = undefined;
	}

	// Build the chosen die in the chosen mode, show it, and run the structural
	// checks on exactly what's shown.
	function rebuild() {
		if (!scene) {
			return;
		}
		const model = dice[selectedKind];
		if (!model) {
			return;
		}
		clearDisplayed();
		const builder = new Builder(model, currentLegends);
		builder.setFrontMaterial(dieMaterial);
		builder.setWallMaterial(dieMaterial);
		builder.setEngravedMaterial(dieMaterial);
		const faceParams = buildFaceParams(model);

		let positions: ArrayLike<number>;
		if (meshMode === 'export') {
			const exportMesh = time('export build', () => builder.export({}, faceParams));
			exportMesh.material = dieMaterial;
			displayed = exportMesh;
			positions = exportMesh.geometry.getAttribute('position').array;
		} else {
			time('working build', () => builder.build({}, faceParams, { explode: false }));
			displayed = builder.diceGroup;
			positions = time('collect working positions', () => collectGroupPositions(builder.diceGroup));
		}
		scene.scene.add(displayed);

		report = time('mesh check', () => checkMesh(positions, { collectBad: true }));
		console.log(`mesh report (${meshMode})`, $state.snapshot(report));
		rebuildProblemOverlay();
	}

	// (re)build the red overlay marking the problem triangles from the last check.
	function rebuildProblemOverlay() {
		if (!scene) {
			return;
		}
		if (problemGroup) {
			problemGroup.traverse((o) => {
				(o as Mesh | Points).geometry?.dispose?.();
			});
			scene.scene.remove(problemGroup);
			problemGroup = undefined;
		}
		const bad = report?.badPositions ?? new Float32Array(0);
		const badEdges = report?.badEdgePositions ?? new Float32Array(0);
		if (!showProblems || (bad.length === 0 && badEdges.length === 0)) {
			stopPulse();
			return;
		}
		const group = new Group();

		// centroids/midpoints of every problem feature get a glowing pulsing
		// marker so even a zero-area sliver or a single bad edge is findable.
		const centroids: Array<number> = [];

		// 1) the actual problem triangles, drawn on top so they're never hidden.
		if (bad.length > 0) {
			const triGeo = new BufferGeometry();
			triGeo.setAttribute('position', new BufferAttribute(bad.slice(), 3));
			triGeo.computeVertexNormals();
			const triMesh = new Mesh(triGeo, problemMaterial);
			triMesh.renderOrder = 999;
			group.add(triMesh);

			for (let i = 0; i < bad.length; i += 9) {
				centroids.push(
					(bad[i] + bad[i + 3] + bad[i + 6]) / 3,
					(bad[i + 1] + bad[i + 4] + bad[i + 7]) / 3,
					(bad[i + 2] + bad[i + 5] + bad[i + 8]) / 3
				);
			}
		}

		// 2) boundary / non-manifold edges as bright lines, with a marker at each
		// midpoint. These are the only signal when the mesh is unsound purely at
		// its edges (no problem triangles).
		if (badEdges.length > 0) {
			const edgeGeo = new BufferGeometry();
			edgeGeo.setAttribute('position', new BufferAttribute(badEdges.slice(), 3));
			const lines = new LineSegments(edgeGeo, edgeMaterial);
			lines.renderOrder = 999;
			group.add(lines);

			for (let i = 0; i < badEdges.length; i += 6) {
				centroids.push(
					(badEdges[i] + badEdges[i + 3]) / 2,
					(badEdges[i + 1] + badEdges[i + 4]) / 2,
					(badEdges[i + 2] + badEdges[i + 5]) / 2
				);
			}
		}

		// 3) glowing pulsing markers at every problem feature's centre.
		const ptGeo = new BufferGeometry();
		ptGeo.setAttribute('position', new BufferAttribute(new Float32Array(centroids), 3));
		const points = new Points(ptGeo, markerMaterial);
		points.renderOrder = 1000;
		group.add(points);

		scene.scene.add(group);
		problemGroup = group;
		startPulse();
	}

	async function reloadAndRebuild() {
		await loadLegends();
		rebuild();
	}

	function setMode(mode: 'export' | 'working') {
		if (meshMode === mode) {
			return;
		}
		meshMode = mode;
		rebuild();
	}
	function onKindChange(value: string) {
		selectedKind = value as keyof typeof dice;
		rebuild();
	}
	function onFontChange(value: string) {
		selectedFontKey = value;
		reloadAndRebuild();
	}
	function toggleEngrave() {
		engraveFaces = !engraveFaces;
		rebuild();
	}
	function toggleProblems() {
		showProblems = !showProblems;
		rebuildProblemOverlay();
	}
	function toggleWireframe() {
		showWireframe = !showWireframe;
		dieMaterial.wireframe = showWireframe;
		dieMaterial.needsUpdate = true;
	}
	function toggleGrid() {
		showGridHelper = !showGridHelper;
		if (!scene) {
			return;
		}
		if (showGridHelper) {
			scene.scene.add(gridHelper);
		} else {
			scene.scene.remove(gridHelper);
		}
	}

	function downloadSTL() {
		if (!displayed) {
			return;
		}
		const data = new STLExporter().parse(displayed, { binary: true });
		const link = document.createElement('a');
		link.download = `${selectedKind}_${meshMode}.stl`;
		link.href = URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: 'model/stl' }));
		link.style.display = 'none';
		document.body.appendChild(link);
		link.click();
	}

	const onSceneReady = (ctx: SceneRenderer) => {
		scene = ctx;
		scene.scene.add(new AxesHelper(50));
		scene.camera.position.set(0, 10, 30);
		scene.camera.zoom = 1.5;
		scene.render();
		reloadAndRebuild();
	};

	// rows for the report panel: [label, value, isBad]
	let reportRows = $derived(
		report
			? [
					['Triangles', String(report.triangleCount), false],
					['Watertight', report.isWatertight ? 'yes' : 'no', !report.isWatertight],
					['Manifold', report.isManifold ? 'yes' : 'no', !report.isManifold],
					['Open edges', String(report.boundaryEdgeCount), report.boundaryEdgeCount > 0],
					[
						'Non-manifold edges',
						String(report.nonManifoldEdgeCount),
						report.nonManifoldEdgeCount > 0
					],
					[
						'Degenerate tris',
						String(report.degenerateTriangleCount),
						report.degenerateTriangleCount > 0
					],
					[
						'Duplicate tris',
						String(report.duplicateTriangleCount),
						report.duplicateTriangleCount > 0
					]
				]
			: []
	);
</script>

<Layout>
	<div class="flex h-full flex-col">
		<Scene class="w-full grow" sceneReady={onSceneReady} />
		<div class="flex flex-row flex-wrap items-start gap-4 p-6">
			<div class="flex flex-col text-sm">
				<span>Mesh</span>
				<div class="flex gap-1">
					<button
						class={'btn ' +
							(meshMode === 'export' ? 'preset-filled-primary-500' : 'preset-tonal-surface')}
						onclick={() => setMode('export')}>export</button
					>
					<button
						class={'btn ' +
							(meshMode === 'working' ? 'preset-filled-primary-500' : 'preset-tonal-surface')}
						onclick={() => setMode('working')}>working</button
					>
				</div>
			</div>

			<label class="flex flex-col text-sm">
				<span>Die</span>
				<select
					class="select"
					value={selectedKind}
					onchange={(e) => onKindChange(e.currentTarget.value)}
				>
					{#each Object.entries(dice) as [k, v]}
						<option value={k}>{v.name}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col text-sm">
				<span>Legend set</span>
				<select
					class="select"
					value={selectedFontKey}
					onchange={(e) => onFontChange(e.currentTarget.value)}
				>
					<optgroup label="Built-in">
						{#each Object.entries(fonts) as [k, v]}
							<option value={k}>{v.name}</option>
						{/each}
					</optgroup>
					{#if customLegends.length > 0}
						<optgroup label="Custom">
							{#each customLegends as legend (legend.id)}
								<option value={legend.id}>{legend.name}</option>
							{/each}
						</optgroup>
					{/if}
				</select>
			</label>

			<div class="flex flex-col gap-2">
				<button
					class={'btn ' + (engraveFaces ? 'preset-filled-primary-500' : 'preset-tonal-primary')}
					onclick={toggleEngrave}>{engraveFaces ? 'engraved' : 'blank'}</button
				>
				<button
					class={'btn ' + (showProblems ? 'preset-filled-warning-500' : 'preset-tonal-surface')}
					onclick={toggleProblems}>highlight problems</button
				>
			</div>
			<div class="flex flex-col gap-2">
				<button class="btn preset-tonal-surface" onclick={toggleWireframe}>toggle wireframe</button>
				<button class="btn preset-tonal-surface" onclick={toggleGrid}>toggle grid</button>
			</div>
			<button class="btn preset-filled-primary-500" onclick={downloadSTL}>download STL</button>

			{#if report}
				<div
					class={'card flex flex-col gap-1 p-3 text-sm ' +
						(report.isPrintable ? 'preset-tonal-success' : 'preset-tonal-error')}
				>
					<span class="font-semibold">
						{report.isPrintable ? 'Looks printable' : 'Mesh problems'} ({meshMode})
					</span>
					{#each reportRows as [label, value, bad]}
						<div class="flex justify-between gap-6">
							<span>{label}</span>
							<span class={bad ? 'text-error-500 font-semibold' : ''}>{value}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</Layout>
