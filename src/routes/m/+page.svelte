<script lang="ts">
	import dice from '$lib/dice';
	import type { FaceParams } from '$lib/interfaces/dice';
	import { Builder } from '$lib/utils/builder';
	import { checkMesh, type MeshCheckReport } from '$lib/utils/mesh_check';
	import fonts, { blanks } from '$lib/fonts';
	import { loadBuiltinById } from '$lib/fonts';
	import { manifold, toFlatPositions } from '$lib/utils/manifold';
	import {
		buildManifoldDieExport,
		disposeManifoldDieExport,
		engraveDie,
		engraveFace,
		getOrBuildBlankManifold,
		type ManifoldDieExport
	} from '$lib/utils/die_manifold';
	import { download, exportThreeMfFromManifold, manifoldToFlatPositions } from '$lib/utils/export';
	import { findBestLegendScalingFactor } from '$lib/utils/shapes';
	import { Legend, loadImmutableLegends, type LegendSet } from '$lib/utils/legends';
	import { buildCandidateOnDie } from '$lib/utils/validate_legends';
	import problemGlyphs from '$lib/utils/__fixtures__/problem_glyphs.json';
	import type { shapeFromJSON } from '$lib/utils/to_json';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import { createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import {
		Box3,
		DoubleSide,
		Mesh,
		MeshNormalMaterial,
		Vector3,
		type Object3D
	} from 'three';
	import { onDestroy } from 'svelte';

	type DieKind = keyof typeof dice;
	type BuildMode = 'blank' | 'one-face' | 'all-faces';
	type LegendSource = 'font' | 'problem-glyphs';
	type ProblemGlyphFixture = {
		label: string;
		note?: string;
		shapes: Parameters<typeof shapeFromJSON>[0][];
	};

	const problemGlyphFixtures = problemGlyphs as Array<ProblemGlyphFixture>;
	const PROBLEM_GLYPH_LEGEND = 1 as Legend;
	const AUDIT_LEGEND_SLOTS = 110;

	// Include dice called out in problem_glyphs.json notes alongside the smoke-test set.
	const dieKinds: Array<DieKind> = [
		'd6_cube',
		'd20_icosahedron',
		'd12_tetartoid',
		'd24_pentagonal_icositetrahedron',
		'd60_pentagonal_hexecontahedron',
		'd2_coin'
	];
	const fontKeys = Object.keys(fonts).filter((k) => k !== 'isBuiltin' && k !== 'loadBuiltinById');

	let selectedKind = $state<DieKind>('d6_cube');
	let selectedFont = $state('voltaire');
	let legendSource = $state<LegendSource>('font');
	let problemGlyphIndex = $state(0);
	let buildMode = $state<BuildMode>('one-face');
	let faceIndex = $state(0);
	let engravingDepth = $state(1);
	let engravingTolerance = $state(0.5);
	let blankSource = $state<'export' | 'prism'>('export');
	let compareLegacy = $state(true);

	let report = $state<MeshCheckReport | undefined>(undefined);
	let legacyReport = $state<MeshCheckReport | undefined>(undefined);
	let timings = $state('');
	let statusLine = $state('Ready');
	let exporting3mf = $state(false);
	let exportReady = $state(false);

	let scene: SceneRenderer | undefined;
	let displayed: Object3D | undefined;
	let dieExport: ManifoldDieExport | undefined;
	let currentLegends: LegendSet = blanks;

	const selectedProblemGlyph = $derived(problemGlyphFixtures[problemGlyphIndex]);

	function problemGlyphLegendSet(fixture: ProblemGlyphFixture): LegendSet {
		return loadImmutableLegends({
			id: 'sandbox-problem-glyphs',
			name: fixture.label,
			shapes: Array.from({ length: AUDIT_LEGEND_SLOTS }, () => fixture.shapes)
		});
	}

	function faceParamsForBuild(
		faces: ReturnType<(typeof dice)[DieKind]['build']>['faces'],
		legends: LegendSet
	): Array<FaceParams> {
		if (legendSource === 'problem-glyphs') {
			const symbols = legends.get(PROBLEM_GLYPH_LEGEND);
			return faces.map((face) => {
				if (face.hidden) {
					return { legend: Legend.BLANK };
				}
				const scale = findBestLegendScalingFactor(
					face.shape,
					symbols,
					engravingTolerance,
					face.convex !== false
				);
				return { legend: PROBLEM_GLYPH_LEGEND, scale };
			});
		}
		return faces.map((face) => {
			if (face.hidden) {
				return { legend: Legend.BLANK };
			}
			const legend = face.defaultLegend;
			const scale = findBestLegendScalingFactor(
				face.shape,
				legends.get(legend),
				engravingTolerance,
				face.convex !== false
			);
			return { legend, scale };
		});
	}

	function clearDisplayed() {
		if (displayed && scene) {
			scene.scene.remove(displayed);
		}
		displayed = undefined;
	}

	function disposeDieExport() {
		disposeManifoldDieExport(dieExport);
		dieExport = undefined;
		exportReady = false;
	}

	function exportFilename(): string {
		const parts = ['manifold', selectedKind, buildMode];
		if (legendSource === 'problem-glyphs') {
			parts.push(
				selectedProblemGlyph.label
					.replace(/[^a-z0-9]+/gi, '_')
					.replace(/^_|_$/g, '')
					.toLowerCase()
			);
		} else {
			parts.push(selectedFont);
		}
		return parts.join('_');
	}

	async function export3mf() {
		if (!dieExport) {
			return;
		}
		exporting3mf = true;
		try {
			const blob = await exportThreeMfFromManifold(exportFilename(), dieExport.manifold, 'y');
			download(blob, `${exportFilename()}.3mf`);
		} catch (e) {
			console.error('manifold sandbox 3MF export failed', e);
			statusLine = e instanceof Error ? `3MF export failed: ${e.message}` : '3MF export failed';
		} finally {
			exporting3mf = false;
		}
	}

	const dieMaterial = new MeshNormalMaterial({ wireframe: false, side: DoubleSide });
	const gridHelper = createGridHelper(60);

	function time<R>(label: string, fn: () => R): R {
		const t0 = performance.now();
		const out = fn();
		const ms = (performance.now() - t0).toFixed(1);
		timings = timings ? `${timings} | ${label}: ${ms}ms` : `${label}: ${ms}ms`;
		return out;
	}

	function dieParams(kind: DieKind): Record<string, number> {
		if (kind === 'd2_coin') {
			return {
				coin_diameter: 24,
				coin_thickness: 3,
				coin_segments: 24,
				engraving_depth: engravingDepth,
				engraving_tolerance: engravingTolerance
			};
		}
		return {
			polyhedron_size: 18,
			engraving_depth: engravingDepth,
			engraving_tolerance: engravingTolerance
		};
	}

	async function loadLegends(): Promise<LegendSet> {
		if (legendSource === 'problem-glyphs') {
			return problemGlyphLegendSet(selectedProblemGlyph);
		}
		return loadBuiltinById(`builtin:${selectedFont}`);
	}

	function fitCameraToObject(object: Object3D) {
		if (!scene) {
			return;
		}
		const box = new Box3().setFromObject(object);
		if (box.isEmpty()) {
			return;
		}
		const center = box.getCenter(new Vector3());
		const size = box.getSize(new Vector3());
		const radius = Math.max(size.x, size.y, size.z) * 0.6;
		scene.camera.position.set(center.x + radius * 1.2, center.y + radius, center.z + radius * 2.5);
		scene.camera.lookAt(center);
	}

	async function rebuild() {
		if (!scene) {
			return;
		}
		timings = '';
		statusLine = 'Building…';
		try {
			currentLegends = await loadLegends();

			const model = dice[selectedKind];
			const params = dieParams(selectedKind);
			const built = model.build(params);
			const faceParams = faceParamsForBuild(built.faces, currentLegends);
			faceIndex = Math.min(faceIndex, Math.max(0, built.faces.length - 1));

			clearDisplayed();
			disposeDieExport();

			let blankExportGeometry: import('three').BufferGeometry | undefined;
			if (blankSource === 'export') {
				const blankBuilder = new Builder(model, currentLegends);
				const blankMesh = time('legacy blank export', () =>
					blankBuilder.export(
						params,
						built.faces.map(() => ({ legend: Legend.BLANK }))
					)
				);
				blankExportGeometry = blankMesh.geometry;
			}

			const blank = time('blank manifold', () =>
				getOrBuildBlankManifold(model.id, built.faces, params, {}, {
					source: blankSource,
					exportGeometry: blankExportGeometry
				})
			);

			let engraved;
			if (buildMode === 'blank') {
				const wasm = manifold();
				const mesh = blank.manifold.getMesh();
				engraved = new wasm.Manifold(mesh);
			} else if (buildMode === 'one-face') {
				const face = built.faces[faceIndex];
				const fp = faceParams[faceIndex] ?? {};
				const symbols = currentLegends.get(fp.legend ?? face.defaultLegend);
				engraved = time('engrave one face', () =>
					engraveFace(blank, face, faceIndex, symbols, fp, engravingDepth)
				);
			} else {
				engraved = time('engrave all faces', () =>
					engraveDie(blank, {
						faces: built.faces,
						legends: currentLegends,
						faceParams,
						depth: engravingDepth,
						tolerance: engravingTolerance
					})
				);
			}
			blank.manifold.delete();

			dieExport = time('manifold → preview', () => buildManifoldDieExport(engraved));
			exportReady = true;

			dieExport.previewMesh.material = dieMaterial;
			displayed = dieExport.previewMesh;
			scene.scene.add(displayed);
			fitCameraToObject(displayed);

			report = time('mesh check', () =>
				checkMesh(manifoldToFlatPositions(dieExport!.manifold, 'y'), { collectBad: true })
			);

			if (compareLegacy) {
				if (legendSource === 'problem-glyphs') {
					const fixture = selectedProblemGlyph;
					legacyReport = time('legacy export', () =>
						checkMesh(
							buildCandidateOnDie(
								{ label: fixture.label, kind: 'legend', shapes: fixture.shapes },
								selectedKind
							)
						)
					);
				} else {
					const legacyBuilder = new Builder(model, currentLegends);
					const legacyMesh = time('legacy export', () => legacyBuilder.export(params, faceParams));
					legacyReport = checkMesh(toFlatPositions(legacyMesh.geometry));
					legacyMesh.geometry.dispose();
				}
			} else {
				legacyReport = undefined;
			}

			statusLine = report.isPrintable
				? 'Manifold path: printable'
				: `Manifold path: ${report.boundaryEdgeCount} boundary, ${report.nonManifoldEdgeCount} non-manifold edges`;
		} catch (e) {
			console.error('manifold sandbox rebuild failed', e);
			statusLine = e instanceof Error ? `Build failed: ${e.message}` : 'Build failed';
			report = undefined;
			legacyReport = undefined;
			disposeDieExport();
		}
	}

	function sceneReady(ctx: SceneRenderer) {
		scene = ctx;
		scene.scene.add(gridHelper);
		scene.camera.position.set(0, 10, 30);
		scene.camera.lookAt(0, 0, 0);
		scene.render();
		rebuild();
	}

	onDestroy(() => {
		clearDisplayed();
		disposeDieExport();
	});
</script>

<Layout>
	<div class="flex flex-col gap-4 p-4">
		<h1 class="text-xl font-semibold">Manifold engraving sandbox</h1>
		<p class="text-sm opacity-80">
			Proof harness for cross-section extrusion + boolean subtract engraving. Compare against
			legacy <code>Builder.export()</code>, or pick a <code>problem_glyphs.json</code> fixture to
			reproduce known libtess failures on difficult dice. Download uses indexed 3MF from the live
			Manifold solid (STL duplicates every triangle corner and tends to false-flag in repair tools).
		</p>

		<div class="flex flex-wrap gap-4 items-end">
			<label class="flex flex-col gap-1">
				<span class="text-sm">Die</span>
				<select
					class="select"
					value={selectedKind}
					onchange={(e) => {
						selectedKind = (e.currentTarget as HTMLSelectElement).value as DieKind;
						rebuild();
					}}
				>
					{#each dieKinds as kind}
						<option value={kind}>{kind}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm">Legend source</span>
				<select
					class="select"
					value={legendSource}
					onchange={(e) => {
						legendSource = (e.currentTarget as HTMLSelectElement).value as LegendSource;
						rebuild();
					}}
				>
					<option value="font">Builtin font</option>
					<option value="problem-glyphs">Problem glyph fixture</option>
				</select>
			</label>

			{#if legendSource === 'font'}
				<label class="flex flex-col gap-1">
					<span class="text-sm">Font</span>
					<select
						class="select"
						value={selectedFont}
						onchange={(e) => {
							selectedFont = (e.currentTarget as HTMLSelectElement).value;
							rebuild();
						}}
					>
						{#each fontKeys as key}
							<option value={key}>{key}</option>
						{/each}
					</select>
				</label>
			{:else}
				<label class="flex flex-col gap-1 min-w-48">
					<span class="text-sm">Problem glyph</span>
					<select
						class="select"
						value={problemGlyphIndex}
						onchange={(e) => {
							problemGlyphIndex = Number((e.currentTarget as HTMLSelectElement).value);
							rebuild();
						}}
					>
						{#each problemGlyphFixtures as fixture, i}
							<option value={i}>{fixture.label}</option>
						{/each}
					</select>
				</label>
			{/if}

			<label class="flex flex-col gap-1">
				<span class="text-sm">Build</span>
				<select
					class="select"
					value={buildMode}
					onchange={(e) => {
						buildMode = (e.currentTarget as HTMLSelectElement).value as BuildMode;
						rebuild();
					}}
				>
					<option value="blank">Blank only</option>
					<option value="one-face">Engrave one face</option>
					<option value="all-faces">Engrave all faces</option>
				</select>
			</label>

			{#if buildMode === 'one-face'}
				<label class="flex flex-col gap-1">
					<span class="text-sm">Face index</span>
					<input
						type="number"
						class="input w-20"
						min="0"
						bind:value={faceIndex}
						onchange={() => rebuild()}
					/>
				</label>
			{/if}

			<label class="flex flex-col gap-1">
				<span class="text-sm">Depth (mm)</span>
				<input
					type="number"
					class="input w-24"
					step="0.1"
					bind:value={engravingDepth}
					onchange={() => rebuild()}
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm">Tolerance (mm)</span>
				<input
					type="number"
					class="input w-24"
					step="0.05"
					bind:value={engravingTolerance}
					onchange={() => rebuild()}
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm">Blank source</span>
				<select
					class="select"
					value={blankSource}
					onchange={(e) => {
						blankSource = (e.currentTarget as HTMLSelectElement).value as 'export' | 'prism';
						rebuild();
					}}
				>
					<option value="export">Export shell (recommended)</option>
					<option value="prism">Face prism union</option>
				</select>
			</label>

			<label class="flex items-center gap-2 pb-1">
				<input type="checkbox" bind:checked={compareLegacy} onchange={() => rebuild()} />
				<span class="text-sm">Compare legacy export</span>
			</label>

			<button class="btn preset-filled-primary-500" onclick={() => rebuild()}>Rebuild</button>

			<button
				class="btn preset-outlined"
				disabled={!exportReady || exporting3mf}
				onclick={() => export3mf()}
			>
				{exporting3mf ? 'Exporting…' : 'Export 3MF'}
			</button>
		</div>

		{#if legendSource === 'problem-glyphs' && selectedProblemGlyph.note}
			<p class="text-sm opacity-80 max-w-3xl">
				<span class="font-medium">{selectedProblemGlyph.label}:</span>
				{selectedProblemGlyph.note}
			</p>
		{/if}

		<div class="grid md:grid-cols-2 gap-4">
			<div class="min-h-80">
				<Scene class="w-full h-80" sceneReady={sceneReady} />
			</div>
			<div class="text-sm font-mono space-y-2">
				<p>{statusLine}</p>
				<p class="opacity-70">{timings}</p>
				{#if report}
					<div>
						<p class="font-semibold">Manifold path</p>
						<ul class="list-disc pl-5">
							<li>triangles: {report.triangleCount}</li>
							<li>watertight: {report.isWatertight}</li>
							<li>manifold: {report.isManifold}</li>
							<li>degenerate: {report.degenerateTriangleCount}</li>
							<li>printable: {report.isPrintable}</li>
						</ul>
					</div>
				{/if}
				{#if legacyReport}
					<div>
						<p class="font-semibold">Legacy export</p>
						<ul class="list-disc pl-5">
							<li>triangles: {legacyReport.triangleCount}</li>
							<li>watertight: {legacyReport.isWatertight}</li>
							<li>manifold: {legacyReport.isManifold}</li>
							<li>degenerate: {legacyReport.degenerateTriangleCount}</li>
							<li>printable: {legacyReport.isPrintable}</li>
						</ul>
					</div>
				{/if}
			</div>
		</div>
	</div>
</Layout>
