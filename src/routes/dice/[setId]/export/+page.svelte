<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Slider from '$lib/components/slider/Slider.svelte';
	import BoxProgressDie from '$lib/box/BoxProgressDie.svelte';
	import type { BuildProgress } from '$lib/box/box_builder';
	import { waitForSet, dieToJSON, type Dice, type DiceSet } from '$lib/interfaces/storage.svelte';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import { m } from '$lib/paraglide/messages';
	import { createFancyRender, createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { debounce } from '$lib/utils/debounce';
	import {
		download,
		exportDieGeometrySig,
		exportOptionCacheSig,
		exportThreeMfGrouped,
		exportThreeMfGroupZip,
		exportThreeMfZip,
		groupMeshesByCategory,
		layoutNamedMeshes,
		type NamedMesh,
		type OptionStates
	} from '$lib/utils/export';
	import { defaultValues, extraBuildOptions, isControlVisible } from '$lib/utils/build_options';
	import Collapsible from '$lib/components/collapsible/Collapsible.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import { type EngravingError } from '$lib/utils/builder';
	import { exportDieInEngine, loadEngineSet } from '$lib/utils/die_engine_client';
	import { legendsJsonForEngine } from '$lib/utils/preview_legends';
	import { mergeMeshReports, type MeshCheckReport } from '$lib/utils/mesh_check';
	import { onMount } from 'svelte';
	import {
		BufferAttribute,
		BufferGeometry,
		DoubleSide,
		Group,
		Mesh,
		MeshBasicMaterial
	} from 'three';
	import { TriangleAlert, ArrowLeft, Download, Frame, Rotate3d, Sparkles } from '@lucide/svelte';
	import { Button } from 'bits-ui';

	const setId = page.params.setId ?? '';

	let setData = $state<DiceSet | undefined>(undefined);
	let ctx = $state<SceneRenderer>();

	let selectedIds = $state<Array<string>>([]);
	// per-die engraving errors (faces whose legend won't engrave / would export
	// broken), keyed by die id. used to default-exclude broken dice and warn.
	let dieErrors = $state<Record<string, Array<EngravingError>>>({});
	let includeDice = $state(true);
	let fileLayout = $state<'single' | 'group' | 'object'>('single');

	let optionStates = $state<OptionStates>(
		Object.fromEntries(
			extraBuildOptions.map((o) => [
				o.id,
				{ enabled: !!o.defaultEnabled, values: defaultValues(o.controls) }
			])
		)
	);

	onMount(async () => {
		setData = await waitForSet(setId);
		if (!setData) {
			goto('/dice');
			return;
		}
		const setJson = JSON.stringify({
			id: setData.id,
			name: setData.name,
			updated: setData.updated,
			dice: setData.dice
		});
		await loadEngineSet(setData.id, setJson, legendsJsonForEngine(setData.legends));
		// build every die once on the first preview pass to discover engraving
		// errors; selectedIds is narrowed after that (see rebuildPreview).
		selectedIds = setData.dice.map((d) => d.id);
	});

	let anyBrokenDice = $derived(Object.values(dieErrors).some((e) => e.length > 0));

	// per-die mesh-health report (manifold / watertight / degenerate), keyed by
	// die id. Produced in the export worker from Manifold index topology (when
	// present) alongside the mesh build. Used to warn about dice that won't
	// slice/print cleanly.
	let meshReports = $state<Record<string, MeshCheckReport>>({});
	let checkingMesh = $state(false);
	let buildingPreview = $state(false);
	let buildProgress = $state<BuildProgress | null>(null);
	let buildFinished = $state(false);
	let atFinalFace = $state(false);
	// bumped on every preview rebuild so stale async check results are ignored.
	let checkGeneration = 0;

	let anyMeshProblems = $derived(Object.values(meshReports).some((r) => !r.isPrintable));

	// true while an export is actively building/writing files, so the button can
	// disable itself and we don't fire overlapping exports.
	let exporting = $state(false);
	// the last export failure, surfaced in the UI. Export errors (e.g. Manifold
	// rejecting input, the 3MF writer failing) used to only reach the console, so
	// a user just saw nothing download. We catch and show them instead.
	let exportError = $state<string | undefined>(undefined);

	// whether to overlay the problem triangles (open/non-manifold/degenerate) in
	// red on the preview. on by default so issues are obvious; toggleable.
	let highlightProblems = $state(true);
	// positions (9 per triangle, in laid-out preview coords) of every problem
	// triangle from the latest check, kept so toggling can rebuild the overlay.
	let problemPositions: Float32Array | undefined;
	// the scene group holding the red problem-triangle overlay mesh.
	let problemGroup: Group | undefined;
	const _problemMaterial = new MeshBasicMaterial({ color: 0xff2222, side: DoubleSide });

	// human-readable list of a die's mesh problems (empty when printable).
	function meshIssues(report: MeshCheckReport | undefined): Array<string> {
		if (!report) {
			return [];
		}
		const issues: Array<string> = [];
		if (report.boundaryEdgeCount > 0) {
			issues.push(m.mesh_check_not_watertight({ count: report.boundaryEdgeCount }));
		}
		if (report.nonManifoldEdgeCount > 0) {
			issues.push(m.mesh_check_non_manifold({ count: report.nonManifoldEdgeCount }));
		}
		if (report.degenerateTriangleCount > 0) {
			issues.push(m.mesh_check_degenerate({ count: report.degenerateTriangleCount }));
		}
		if (report.duplicateTriangleCount > 0) {
			issues.push(m.mesh_check_duplicate({ count: report.duplicateTriangleCount }));
		}
		return issues;
	}

	// Apply per-die mesh reports produced with the export build (indexed Manifold
	// topology when available). Results from superseded builds are dropped.
	function applyMeshReports(entries: Array<[string, MeshCheckReport]>, generation: number) {
		if (generation !== checkGeneration) {
			return;
		}
		meshReports = Object.fromEntries(entries);
		problemPositions = concatBadPositions(entries.map(([, r]) => r.badPositions));
		updateProblemHighlight();
		checkingMesh = false;
	}

	// flatten every die's problem-triangle buffer into one (or undefined when
	// there are none).
	function concatBadPositions(buffers: Array<Float32Array | undefined>): Float32Array | undefined {
		const present = buffers.filter((b): b is Float32Array => !!b && b.length > 0);
		if (present.length === 0) {
			return undefined;
		}
		const total = present.reduce((n, b) => n + b.length, 0);
		const out = new Float32Array(total);
		let off = 0;
		for (const b of present) {
			out.set(b, off);
			off += b.length;
		}
		return out;
	}

	// (re)build the red overlay mesh marking problem triangles, respecting the
	// highlight toggle. cheap to call repeatedly; disposes the previous overlay.
	function updateProblemHighlight() {
		if (problemGroup) {
			problemGroup.traverse((o) => {
				const mesh = o as Mesh;
				if (mesh.isMesh) {
					mesh.geometry?.dispose();
				}
			});
			ctx?.scene.remove(problemGroup);
			problemGroup = undefined;
		}
		if (!ctx || !highlightProblems || !problemPositions || problemPositions.length === 0) {
			// the continuous render loop will redraw without the overlay.
			return;
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(problemPositions.slice(), 3));
		geo.computeVertexNormals();
		const group = new Group();
		group.add(new Mesh(geo, _problemMaterial));
		ctx.scene.add(group);
		problemGroup = group;
	}

	function toggleHighlight() {
		highlightProblems = !highlightProblems;
		updateProblemHighlight();
	}

	const gridHelper = createGridHelper(80);

	let fancyRender = $state<ReturnType<typeof createFancyRender>>();
	let fancy = $state(true);
	let autoRotate = $state(false);
	let previewMeshes: Array<Mesh> = [];
	let previewNamed: Array<NamedMesh> = [];
	// Per-die export meshes at the origin, split by group so toggling blanks /
	// platforms / "include dice" can reuse cached geometry instead of rebuilding.
	type GroupCache = {
		sig: string;
		meshes: Array<NamedMesh>;
		meshReport: MeshCheckReport;
		/** Enclosed volume (mm³) from Manifold.volume() at build time. */
		volumeMm3: number;
	};
	type DieExportCache = {
		dieSig: string;
		engravingErrors: Array<EngravingError>;
		groups: Record<string, GroupCache>;
	};
	const exportMeshCache = new Map<string, DieExportCache>();
	let errorsInitialized = false;

	function disposeGroupCache(group: GroupCache | undefined) {
		if (!group) {
			return;
		}
		for (const n of group.meshes) {
			n.mesh.geometry.dispose();
		}
	}

	function disposeExportCacheEntry(entry: DieExportCache | undefined) {
		if (!entry) {
			return;
		}
		for (const g of Object.values(entry.groups)) {
			disposeGroupCache(g);
		}
	}

	function cloneNamedForLayout(named: Array<NamedMesh>): Array<NamedMesh> {
		return named.map((n) => ({
			...n,
			mesh: new Mesh(n.mesh.geometry.clone(), n.mesh.material)
		}));
	}

	/** Meshes currently visible for a die given includeDice + enabled options. */
	function visibleCachedMeshes(
		entry: DieExportCache,
		include: boolean,
		options: OptionStates
	): Array<NamedMesh> {
		const out: Array<NamedMesh> = [];
		if (include && entry.groups.dice) {
			out.push(...entry.groups.dice.meshes);
		}
		for (const option of extraBuildOptions) {
			if (!options[option.id]?.enabled) {
				continue;
			}
			const g = entry.groups[option.id];
			if (g) {
				out.push(...g.meshes);
			}
		}
		return out;
	}

	function visibleMeshReport(
		entry: DieExportCache,
		include: boolean,
		options: OptionStates
	): MeshCheckReport | undefined {
		const reports: Array<MeshCheckReport> = [];
		if (include && entry.groups.dice) {
			reports.push(entry.groups.dice.meshReport);
		}
		for (const option of extraBuildOptions) {
			if (!options[option.id]?.enabled) {
				continue;
			}
			const g = entry.groups[option.id];
			if (g) {
				reports.push(g.meshReport);
			}
		}
		return reports.length > 0 ? mergeMeshReports(reports) : undefined;
	}

	/** One worker job = one group for one die (dice / blanks / platforms). */
	type ExportBuildJob = {
		die: Dice;
		dieSig: string;
		group: string;
		label: string;
		includeDice: boolean;
		optionStates: OptionStates;
	};

	function emptyOptionStates(options: OptionStates): OptionStates {
		return Object.fromEntries(
			extraBuildOptions.map((o) => [
				o.id,
				{
					enabled: false,
					values: options[o.id]?.values ?? defaultValues(o.controls)
				}
			])
		);
	}

	/** Missing/stale groups as separate jobs — never couples dice with blanks. */
	function collectMissingJobs(
		entry: DieExportCache | undefined,
		dieSig: string,
		wantDice: boolean,
		options: OptionStates
	): Array<Pick<ExportBuildJob, 'group' | 'label' | 'includeDice' | 'optionStates'>> {
		const jobs: Array<Pick<ExportBuildJob, 'group' | 'label' | 'includeDice' | 'optionStates'>> =
			[];
		if (wantDice && (!entry?.groups.dice || entry.groups.dice.sig !== dieSig)) {
			jobs.push({
				group: 'dice',
				label: m.export_building_dice(),
				includeDice: true,
				optionStates: emptyOptionStates(options)
			});
		}
		for (const option of extraBuildOptions) {
			const state = options[option.id];
			if (!state?.enabled) {
				continue;
			}
			const sig = exportOptionCacheSig(dieSig, option.id, state.values);
			const cached = entry?.groups[option.id];
			if (!cached || cached.sig !== sig) {
				const optionStates = emptyOptionStates(options);
				optionStates[option.id] = { enabled: true, values: state.values };
				jobs.push({
					group: option.id,
					label: m.export_building_option({ option: option.label() }),
					includeDice: false,
					optionStates
				});
			}
		}
		return jobs;
	}

	function mergeExportResultIntoCache(
		dieId: string,
		dieSig: string,
		result: Awaited<ReturnType<typeof exportDieInEngine>>,
		requested: { includeDice: boolean; optionStates: OptionStates }
	): DieExportCache {
		let entry = exportMeshCache.get(dieId);
		if (!entry || entry.dieSig !== dieSig) {
			disposeExportCacheEntry(entry);
			entry = { dieSig, engravingErrors: result.engravingErrors, groups: {} };
			exportMeshCache.set(dieId, entry);
		} else {
			entry.engravingErrors = result.engravingErrors;
		}

		const byGroup = new Map<string, Array<NamedMesh>>();
		for (const m of result.meshes) {
			const named: NamedMesh = {
				name: m.name,
				mesh: m.mesh,
				dieId: m.dieId,
				group: m.group
			};
			const list = byGroup.get(m.group) ?? [];
			list.push(named);
			byGroup.set(m.group, list);
		}

		// Use the worker's report (Manifold index topology). Re-checking the
		// transferred Three.js buffer here false-flags micro-edges as non-manifold
		// — the solids were already verified before manifolds were disposed.
		const report = result.meshReport;

		if (requested.includeDice) {
			const meshes = byGroup.get('dice') ?? [];
			disposeGroupCache(entry.groups.dice);
			entry.groups.dice = {
				sig: dieSig,
				meshes,
				meshReport: report,
				volumeMm3: result.groupVolumesMm3.dice ?? 0
			};
		}
		for (const option of extraBuildOptions) {
			const state = requested.optionStates[option.id];
			if (!state?.enabled) {
				continue;
			}
			const meshes = byGroup.get(option.id) ?? [];
			disposeGroupCache(entry.groups[option.id]);
			entry.groups[option.id] = {
				sig: exportOptionCacheSig(dieSig, option.id, state.values),
				meshes,
				meshReport: report,
				volumeMm3: result.groupVolumesMm3[option.id] ?? 0
			};
		}
		return entry;
	}

	// the render tuning panel is exposed in developer mode.
	const prefs = getPreferences();
	let devMode = $derived(prefs.developerMode);
	let showTuning = $derived(prefs.developerMode);
	// developer-mode wireframe toggle for the export scene.
	let wireframeOn = $state(false);
	$effect(() => {
		if (!devMode && wireframeOn) {
			wireframeOn = false;
		}
		ctx?.setWireframe(wireframeOn);
	});

	// TEMP tuning panel state. Defaults mirror createFancyRender(). Once good
	// values are found these (and the panel markup) can be removed.
	let tune = $state({
		r: 0.42,
		g: 0.48,
		b: 0.58,
		roughness: 1.0,
		metalness: 0.25,
		clearcoat: 0.81,
		clearcoatRoughness: 0.5,
		envMapIntensity: 0.9,
		exposure: 1.0,
		lightIntensity: 2.2,
		lightIntensity2: 8,
		fillIntensity: 1.5,
		aoRadius: 2.5,
		aoScale: 1.0,
		aoThickness: 1.0,
		aoDistanceExponent: 1.0
	});

	// TEMP: push tuning values into the live render objects.
	$effect(() => {
		const fr = fancyRender;
		if (!fr || !ctx) {
			return;
		}
		fr.setColor(tune.r, tune.g, tune.b);
		fr.material.roughness = tune.roughness;
		fr.material.metalness = tune.metalness;
		fr.material.clearcoat = tune.clearcoat;
		fr.material.clearcoatRoughness = tune.clearcoatRoughness;
		fr.material.envMapIntensity = tune.envMapIntensity;
		ctx.renderer.toneMappingExposure = tune.exposure;
		fr.keyLight.intensity = tune.lightIntensity;
		fr.keyLight2.intensity = tune.lightIntensity2;
		fr.fillLight.intensity = tune.fillIntensity;
		fr.ao.updateGtaoMaterial({
			radius: tune.aoRadius,
			scale: tune.aoScale,
			thickness: tune.aoThickness,
			distanceExponent: tune.aoDistanceExponent
		});
	});

	const sceneReady = (_ctx: SceneRenderer) => {
		ctx = _ctx;
		_ctx.scene.add(gridHelper);
		_ctx.camera.position.set(0, 60, 90);
		_ctx.camera.lookAt(0, 0, 0);
		fancyRender = createFancyRender(_ctx);
		fancyRender.setEnabled(fancy);
		gridHelper.visible = !fancy;
		// start the render loop (otherwise the canvas stays blank).
		_ctx.render();
	};

	function toggleFancy() {
		fancy = !fancy;
		fancyRender?.setEnabled(fancy);
		gridHelper.visible = !fancy;
		previewMeshes.forEach((m) => fancyRender?.styleMesh(m));
	}

	function toggleAutoRotate() {
		autoRotate = !autoRotate;
		ctx?.setAutoRotate(autoRotate);
	}

	let previewGroup: Group | undefined;

	/** Instantly refresh the scene from whatever groups are already cached. */
	function applyPreviewFromCache(
		optionSnap: OptionStates,
		include: boolean,
		ids: Array<string>,
		generation: number
	) {
		if (!ctx) {
			return;
		}
		if (previewGroup) {
			ctx.scene.remove(previewGroup);
			previewGroup = undefined;
		}
		for (const n of previewNamed) {
			n.mesh.geometry.dispose();
		}

		const named: Array<NamedMesh> = [];
		for (const id of ids) {
			const entry = exportMeshCache.get(id);
			if (!entry) {
				continue;
			}
			named.push(...cloneNamedForLayout(visibleCachedMeshes(entry, include, optionSnap)));
		}

		previewNamed = named;
		let diceMm3 = 0;
		const vols: Record<string, number> = {};
		for (const id of ids) {
			const entry = exportMeshCache.get(id);
			if (!entry) {
				continue;
			}
			if (include && entry.groups.dice) {
				diceMm3 += entry.groups.dice.volumeMm3;
			}
			for (const option of extraBuildOptions) {
				if (!optionSnap[option.id]?.enabled) {
					continue;
				}
				const g = entry.groups[option.id];
				if (!g || g.volumeMm3 <= 0) {
					continue;
				}
				vols[option.id] = (vols[option.id] ?? 0) + g.volumeMm3 / 1000;
			}
		}
		diceVolumeMl = diceMm3 / 1000;
		artifactVolumesMl = vols;
		layoutNamedMeshes(named);
		const group = new Group();
		const meshes = named.map((n) => n.mesh);
		meshes.forEach((mesh) => {
			fancyRender?.styleMesh(mesh);
			group.add(mesh);
		});
		ctx.scene.add(group);
		previewGroup = group;
		previewMeshes = meshes;

		const reports: Array<[string, MeshCheckReport]> = ids
			.map((id) => {
				const entry = exportMeshCache.get(id);
				if (!entry) {
					return undefined;
				}
				const report = visibleMeshReport(entry, include, optionSnap);
				return report ? ([id, report] as const) : undefined;
			})
			.filter((e): e is [string, MeshCheckReport] => !!e);
		applyMeshReports(reports, generation);
	}

	async function rebuildPreview() {
		if (!ctx || !setData) {
			return;
		}
		problemPositions = undefined;
		updateProblemHighlight();

		const optionSnap = $state.snapshot(optionStates) as OptionStates;
		const legendsJson = legendsJsonForEngine(setData.legends);
		const buildingAllForErrors = !errorsInitialized;
		const generation = ++checkGeneration;

		try {
			const diceJobs: Array<ExportBuildJob> = [];
			const optionJobs: Array<ExportBuildJob> = [];

			for (const die of setData.dice) {
				if (!buildingAllForErrors && !selectedIds.includes(die.id)) {
					continue;
				}
				const dieSig = exportDieGeometrySig(die, setData.legends.id);
				let entry = exportMeshCache.get(die.id);
				if (entry && entry.dieSig !== dieSig) {
					disposeExportCacheEntry(entry);
					exportMeshCache.delete(die.id);
					entry = undefined;
				}
				const wantDice = buildingAllForErrors || includeDice;
				for (const job of collectMissingJobs(entry, dieSig, wantDice, optionSnap)) {
					const full = { die, dieSig, ...job };
					if (job.group === 'dice') {
						diceJobs.push(full);
					} else {
						optionJobs.push(full);
					}
				}
			}
			const jobs = [...diceJobs, ...optionJobs];

			// Show whatever is already cached immediately (hide blanks without waiting).
			const visibleIds = buildingAllForErrors
				? setData.dice.map((d) => d.id)
				: selectedIds;
			applyPreviewFromCache(optionSnap, includeDice, visibleIds, generation);

			if (jobs.length === 0) {
				buildingPreview = false;
				buildProgress = null;
				buildFinished = false;
				if (!errorsInitialized) {
					const errs: Record<string, Array<EngravingError>> = {};
					for (const d of setData.dice) {
						errs[d.id] = exportMeshCache.get(d.id)?.engravingErrors ?? [];
					}
					dieErrors = errs;
					selectedIds = setData.dice
						.filter((d) => (errs[d.id]?.length ?? 0) === 0)
						.map((d) => d.id);
					errorsInitialized = true;
					applyPreviewFromCache(optionSnap, includeDice, selectedIds, generation);
				}
				for (const id of [...exportMeshCache.keys()]) {
					if (!selectedIds.includes(id)) {
						disposeExportCacheEntry(exportMeshCache.get(id));
						exportMeshCache.delete(id);
					}
				}
				return;
			}

			buildingPreview = true;
			buildFinished = false;
			atFinalFace = false;
			checkingMesh = true;
			buildProgress = {
				step: 0,
				totalSteps: jobs.length,
				phase: 'prepare',
				label: m.export_building_dice()
			};

			for (let i = 0; i < jobs.length; i++) {
				if (generation !== checkGeneration) {
					return;
				}
				const job = jobs[i];
				buildProgress = {
					step: i + 1,
					totalSteps: jobs.length,
					phase: 'prepare',
					label: m.export_building_progress({
						current: i + 1,
						total: jobs.length,
						label: job.label
					})
				};
				const result = await exportDieInEngine(
					dieToJSON(job.die),
					legendsJson,
					job.includeDice,
					JSON.stringify(job.optionStates)
				);
				if (generation !== checkGeneration) {
					return;
				}
				mergeExportResultIntoCache(job.die.id, job.dieSig, result, {
					includeDice: job.includeDice,
					optionStates: job.optionStates
				});

				if (!errorsInitialized && job.includeDice) {
					// keep going — finish all dice jobs before narrowing selection
				}

				const idsForPreview = errorsInitialized ? selectedIds : setData.dice.map((d) => d.id);
				applyPreviewFromCache(optionSnap, includeDice, idsForPreview, generation);
			}

			if (!errorsInitialized) {
				const errs: Record<string, Array<EngravingError>> = {};
				for (const d of setData.dice) {
					errs[d.id] = exportMeshCache.get(d.id)?.engravingErrors ?? [];
				}
				dieErrors = errs;
				selectedIds = setData.dice
					.filter((d) => (errs[d.id]?.length ?? 0) === 0)
					.map((d) => d.id);
				errorsInitialized = true;
				applyPreviewFromCache(optionSnap, includeDice, selectedIds, generation);
			}

			for (const id of [...exportMeshCache.keys()]) {
				if (!selectedIds.includes(id)) {
					disposeExportCacheEntry(exportMeshCache.get(id));
					exportMeshCache.delete(id);
				}
			}

			if (generation === checkGeneration) {
				buildFinished = true;
			}
		} catch (err) {
			console.warn('export preview rebuild failed', err);
			if (generation === checkGeneration) {
				checkingMesh = false;
				buildingPreview = false;
				buildProgress = null;
				buildFinished = false;
			}
		}
	}
	const schedulePreview = debounce<void>(150, () => {
		void rebuildPreview();
	});

	// linger briefly after compute finishes AND the countdown die has rolled to
	// its final face, matching the box builder indicator.
	$effect(() => {
		if (buildingPreview && buildFinished && atFinalFace) {
			const timer = setTimeout(() => {
				buildingPreview = false;
				buildProgress = null;
				buildFinished = false;
			}, 50);
			return () => clearTimeout(timer);
		}
	});

	// signature of everything the preview depends on, so the effect re-runs when
	// any option/selection changes.
	let previewSig = $derived(
		JSON.stringify({ ids: selectedIds, dice: includeDice, opts: $state.snapshot(optionStates) })
	);
	$effect(() => {
		previewSig;
		if (ctx && setData) {
			schedulePreview();
		}
	});

	function dieLabel(kind: string, idx: number): string {
		return `${idx + 1}. ${m.dice_name({ kind })}`;
	}

	function toggleDie(id: string, checked: boolean) {
		if (checked) {
			if (!selectedIds.includes(id)) {
				selectedIds = [...selectedIds, id];
			}
		} else {
			selectedIds = selectedIds.filter((x) => x !== id);
		}
	}

	function selectAll() {
		selectedIds = setData?.dice.map((d) => d.id) ?? [];
	}
	function selectNone() {
		selectedIds = [];
	}

	function setOptionValue(optionId: string, controlId: string, value: number | boolean) {
		optionStates[optionId].values[controlId] = value;
	}

	let anyOptionEnabled = $derived(extraBuildOptions.some((o) => optionStates[o.id]?.enabled));
	let nothingToExport = $derived(selectedIds.length === 0 || (!includeDice && !anyOptionEnabled));

	// 1 ml = 1 cm³ = 1000 mm³ and the three.js unit is a mm.
	const volumeFormat = new Intl.NumberFormat(undefined, {
		maximumFractionDigits: 2,
		trailingZeroDisplay: 'stripIfInteger'
	});

	// Numbered-die blank volume (ml), from Manifold.volume() of the cached blank
	// solid (excludes engraving). Populated when dice are built in the worker;
	// invalidated/refreshed whenever die size (params) changes and rebuilds.
	let diceVolumeMl = $state(0);

	// per-build-option artifact volumes (ml), from Manifold.volume() measured in
	// the export worker at build time and cached with each group.
	let artifactVolumesMl = $state<Record<string, number>>({});

	// one row per non-empty export group (the dice, plus any enabled build option
	// that produced geometry), in registry order with dice first.
	let volumeGroups = $derived.by(() => {
		const rows: Array<{ id: string; label: string; volume: number }> = [];
		if (includeDice && diceVolumeMl > 0) {
			rows.push({ id: 'dice', label: m.export_include_dice(), volume: diceVolumeMl });
		}
		for (const option of extraBuildOptions) {
			const v = artifactVolumesMl[option.id];
			if (v && v > 0) {
				rows.push({ id: option.id, label: option.label(), volume: v });
			}
		}
		return rows;
	});
	let totalVolumeMl = $derived(volumeGroups.reduce((sum, row) => sum + row.volume, 0));

	// the "one file per group" layout only makes sense with more than one group
	// (dice + at least one artifact type). Fall back to a single file otherwise.
	let multiGroup = $derived(volumeGroups.length > 1);
	$effect(() => {
		if (fileLayout === 'group' && !multiGroup) {
			fileLayout = 'single';
		}
	});

	async function exportModel() {
		if (!setData || nothingToExport || exporting) {
			return;
		}
		exporting = true;
		exportError = undefined;
		const legendsJson = legendsJsonForEngine(setData.legends);
		const optionStatesJson = JSON.stringify($state.snapshot(optionStates));
		const named: Array<NamedMesh> = [];
		for (const die of setData.dice) {
			if (!selectedIds.includes(die.id)) {
				continue;
			}
			const result = await exportDieInEngine(
				dieToJSON(die),
				legendsJson,
				includeDice,
				optionStatesJson
			);
			for (const m of result.meshes) {
				named.push({
					name: m.name,
					mesh: m.mesh,
					dieId: m.dieId,
					group: m.group
				});
			}
		}
		try {
			const name = (setData.name || 'set').replace(/[^a-z0-9-_]+/gi, '_');
			const groups = groupMeshesByCategory(named, name);
			if (fileLayout === 'object') {
				download(await exportThreeMfZip(named, 'y'), `${name}.zip`);
			} else if (fileLayout === 'group' && groups.length > 1) {
				for (const g of groups) {
					layoutNamedMeshes(g.meshes);
				}
				download(await exportThreeMfGroupZip(groups, 'y'), `${name}.zip`);
			} else {
				layoutNamedMeshes(named);
				download(await exportThreeMfGrouped(groups, 'y'), `${name}.3mf`);
			}
		} catch (err) {
			console.error('export failed', err);
			const detail = err instanceof Error ? err.message : String(err);
			exportError = m.export_failed({ detail });
		} finally {
			for (const n of named) {
				n.mesh.geometry.dispose();
			}
			exporting = false;
		}
	}
</script>

<Layout>
	{#snippet header()}
		<a class="btn preset-tonal-surface" href={'/dice/' + setId}>
			<ArrowLeft class="size-4" />
		</a>
		<p class="text-primary-500 h4">{setData?.name}</p>
	{/snippet}

	<div class="flex h-full flex-row gap-4 p-4">
		<Scene class="relative h-full grow" {sceneReady}>
			<ul class="list-style-type-none absolute top-2 left-2 flex flex-col gap-2">
				<li>
					<Tooltip content={m.export_toggle_fancy_render()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class={'btn-icon ' + (fancy ? 'preset-filled-secondary-500' : 'preset-filled-primary-500')}
								aria-label={m.export_toggle_fancy_render()}
								aria-pressed={fancy}
								onclick={toggleFancy}><Sparkles /></Button.Root
							>
						{/snippet}
					</Tooltip>
				</li>
				<li>
					<Tooltip content={m.export_toggle_auto_rotate()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class={'btn-icon ' +
									(autoRotate ? 'preset-filled-secondary-500' : 'preset-filled-primary-500')}
								aria-label={m.export_toggle_auto_rotate()}
								aria-pressed={autoRotate}
								onclick={toggleAutoRotate}><Rotate3d /></Button.Root
							>
						{/snippet}
					</Tooltip>
				</li>
				{#if anyMeshProblems}
					<li>
						<Tooltip content={m.export_toggle_problem_highlight()} side="right">
							{#snippet children(props)}
								<Button.Root
									{...props}
									class={'btn-icon ' +
										(highlightProblems ? 'preset-filled-warning-500' : 'preset-tonal-warning')}
									aria-label={m.export_toggle_problem_highlight()}
									aria-pressed={highlightProblems}
									onclick={toggleHighlight}><TriangleAlert /></Button.Root
								>
							{/snippet}
						</Tooltip>
					</li>
				{/if}
				{#if devMode}
					<li>
						<Tooltip content={m.controls_toggle_wireframe()} side="right">
							{#snippet children(props)}
								<Button.Root
									{...props}
									class={'btn-icon ' +
										(wireframeOn ? 'preset-filled-secondary-500' : 'preset-tonal-primary')}
									aria-label={m.controls_toggle_wireframe()}
									aria-pressed={wireframeOn}
									onclick={() => {
										wireframeOn = !wireframeOn;
									}}><Frame /></Button.Root
								>
							{/snippet}
						</Tooltip>
					</li>
				{/if}
			</ul>
			{#if buildingPreview}
				<div
					class="pointer-events-none absolute inset-0 z-10 flex items-end justify-center p-4"
					aria-live="polite"
				>
					<div class="pointer-events-auto">
						<BoxProgressDie progress={buildProgress} complete={buildFinished} bind:atFinalFace />
					</div>
				</div>
			{/if}
		</Scene>

		<div class="card preset-tonal-surface flex w-80 shrink-0 flex-col gap-3 overflow-y-auto p-4">
			{#snippet tuneRow(
				label: string,
				value: number,
				min: number,
				max: number,
				step: number,
				set: (v: number) => void
			)}
				<div class="flex flex-col">
					<span class="flex justify-between text-xs">
						<span>{label}</span>
						<span>{value.toFixed(2)}</span>
					</span>
					<Slider class="py-1" {value} {min} {max} {step} onChange={set} />
				</div>
			{/snippet}
			{#if showTuning}
				<Collapsible defaultOpen={false} title={m.export_render_tuning_title()}>
					<div class="flex flex-col gap-2 pt-2">
						<p class="text-surface-600-400 text-xs">{m.export_render_tuning_hint()}</p>
						<span class="text-sm font-semibold">{m.export_render_tuning_base_colour()}</span>
						<div
							class="h-6 w-full rounded"
							style={`background: rgb(${Math.round(tune.r * 255)}, ${Math.round(tune.g * 255)}, ${Math.round(tune.b * 255)})`}
						></div>
						{@render tuneRow(m.export_render_tuning_r(), tune.r, 0, 1, 0.01, (v) => (tune.r = v))}
						{@render tuneRow(m.export_render_tuning_g(), tune.g, 0, 1, 0.01, (v) => (tune.g = v))}
						{@render tuneRow(m.export_render_tuning_b(), tune.b, 0, 1, 0.01, (v) => (tune.b = v))}
						<span class="text-sm font-semibold">{m.export_render_tuning_material()}</span>
						{@render tuneRow(
							m.export_render_tuning_roughness(),
							tune.roughness,
							0,
							1,
							0.01,
							(v) => (tune.roughness = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_metalness(),
							tune.metalness,
							0,
							1,
							0.01,
							(v) => (tune.metalness = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_clearcoat(),
							tune.clearcoat,
							0,
							1,
							0.01,
							(v) => (tune.clearcoat = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_clearcoat_rough(),
							tune.clearcoatRoughness,
							0,
							1,
							0.01,
							(v) => (tune.clearcoatRoughness = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_env_intensity(),
							tune.envMapIntensity,
							0,
							3,
							0.05,
							(v) => (tune.envMapIntensity = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_exposure(),
							tune.exposure,
							0,
							3,
							0.05,
							(v) => (tune.exposure = v)
						)}
						<span class="text-sm font-semibold">{m.export_render_tuning_lighting()}</span>
						{@render tuneRow(
							m.export_render_tuning_key_light(),
							tune.lightIntensity,
							0,
							12,
							0.1,
							(v) => (tune.lightIntensity = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_key_light_2(),
							tune.lightIntensity2,
							0,
							12,
							0.1,
							(v) => (tune.lightIntensity2 = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_fill(),
							tune.fillIntensity,
							0,
							5,
							0.05,
							(v) => (tune.fillIntensity = v)
						)}
						<span class="text-sm font-semibold">{m.export_render_tuning_ao()}</span>
						{@render tuneRow(
							m.export_render_tuning_ao_radius(),
							tune.aoRadius,
							0,
							10,
							0.1,
							(v) => (tune.aoRadius = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_ao_scale(),
							tune.aoScale,
							0,
							3,
							0.05,
							(v) => (tune.aoScale = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_ao_thickness(),
							tune.aoThickness,
							0,
							3,
							0.05,
							(v) => (tune.aoThickness = v)
						)}
						{@render tuneRow(
							m.export_render_tuning_ao_dist_exp(),
							tune.aoDistanceExponent,
							0.1,
							4,
							0.05,
							(v) => (tune.aoDistanceExponent = v)
						)}
					</div>
				</Collapsible>
			{/if}

			<!-- dice selection -->
			<Collapsible title={m.export_select_dice()}>
				<div class="flex flex-col gap-2 pt-2">
					<div class="flex justify-end gap-2 text-xs">
						<button class="anchor" onclick={selectAll}>{m.export_select_all()}</button>
						<button class="anchor" onclick={selectNone}>{m.export_select_none()}</button>
					</div>
					<div class="flex flex-col gap-1">
						{#each setData?.dice ?? [] as die, idx}
							{@const errs = dieErrors[die.id] ?? []}
							{@const mIssues = meshIssues(meshReports[die.id])}
							<div class="flex items-center gap-2 text-sm">
								<label class="flex flex-1 items-center gap-2">
									<input
										type="checkbox"
										class="checkbox"
										checked={selectedIds.includes(die.id)}
										onchange={(e) => toggleDie(die.id, e.currentTarget.checked)}
									/>
									<span class={errs.length > 0 ? 'text-warning-600-400' : ''}>
										{dieLabel(die.kind, idx)}
									</span>
								</label>
								{#if errs.length > 0}
									<Tooltip side="left">
										{#snippet content()}
											<div class="flex flex-col gap-0.5">
												{#each errs as err}
													<span>{m.engraving_broken_for({ legend: err.legendName })}</span>
												{/each}
											</div>
										{/snippet}
										{#snippet children(props)}
											<span
												{...props}
												class="text-error-500 cursor-help"
												aria-label={m.engraving_errors_title()}
											>
												<TriangleAlert size={16} />
											</span>
										{/snippet}
									</Tooltip>
								{/if}
								{#if mIssues.length > 0}
									<Tooltip side="left">
										{#snippet content()}
											<div class="flex flex-col gap-0.5">
												{#each mIssues as issue}
													<span>{issue}</span>
												{/each}
											</div>
										{/snippet}
										{#snippet children(props)}
											<span
												{...props}
												class="text-warning-600-400 cursor-help"
												aria-label={m.mesh_check_title()}
											>
												<TriangleAlert size={16} />
											</span>
										{/snippet}
									</Tooltip>
								{/if}
							</div>
						{/each}
					</div>
					{#if anyBrokenDice}
						<p class="text-warning-600-400 text-xs">{m.engraving_excluded_hint()}</p>
					{/if}
					{#if anyMeshProblems}
						<p class="text-warning-600-400 text-xs">{m.mesh_check_hint()}</p>
					{/if}
				</div>
			</Collapsible>

			<!-- what to export -->
			<Collapsible title={m.export_what_to_export()}>
				<div class="flex flex-col gap-3 pt-2">
					<div class="border-surface-300-700 rounded-md border p-2">
						<label class="flex items-center justify-between gap-2">
							<span>{m.export_include_dice()}</span>
							<input
								type="checkbox"
								class="checkbox"
								checked={includeDice}
								onchange={(e) => (includeDice = e.currentTarget.checked)}
							/>
						</label>
						<p class="text-surface-600-400 text-xs">{m.export_include_dice_hint()}</p>
					</div>
					{#each extraBuildOptions as option}
						<div class="border-surface-300-700 rounded-md border p-2">
							<label class="flex items-center justify-between gap-2">
								<span>{option.label()}</span>
								<input
									type="checkbox"
									class="checkbox"
									checked={optionStates[option.id].enabled}
									onchange={(e) => (optionStates[option.id].enabled = e.currentTarget.checked)}
								/>
							</label>
							{#if option.description}
								<p class="text-surface-600-400 text-xs">{option.description()}</p>
							{/if}
							{#if optionStates[option.id].enabled}
								<div class="mt-2 flex flex-col gap-2">
									{#each option.controls as control}
										{#if isControlVisible(control, optionStates[option.id].values)}
											{#if control.kind === 'number'}
												<div class="flex flex-col">
													<span class="flex justify-between text-sm">
														<span>{control.label()}</span>
														<span>
															{optionStates[option.id].values[control.id]}{control.unit
																? ' ' + control.unit()
																: ''}
														</span>
													</span>
													<Slider
														class="py-1"
														value={Number(optionStates[option.id].values[control.id])}
														min={control.min}
														max={control.max}
														step={control.step}
														onChange={(v) => setOptionValue(option.id, control.id, v)}
													/>
													{#if control.help}
														<p class="text-surface-600-400 text-xs">{control.help()}</p>
													{/if}
												</div>
											{/if}
											{#if control.kind === 'bool'}
												<div class="flex flex-col">
													<label class="flex items-center justify-between gap-2 text-sm">
														<span>{control.label()}</span>
														<input
															type="checkbox"
															class="checkbox"
															checked={Boolean(optionStates[option.id].values[control.id])}
															onchange={(e) =>
																setOptionValue(option.id, control.id, e.currentTarget.checked)}
														/>
													</label>
													{#if control.help}
														<p class="text-surface-600-400 text-xs">{control.help()}</p>
													{/if}
												</div>
											{/if}
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</Collapsible>

			<!-- file layout -->
			<Collapsible title={m.export_file_layout()}>
				<div class="flex flex-col gap-2 pt-2">
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" class="radio" value="single" bind:group={fileLayout} />
						<span>{m.export_file_single()}</span>
					</label>
					{#if multiGroup}
						<label class="flex items-center gap-2 text-sm">
							<input type="radio" class="radio" value="group" bind:group={fileLayout} />
							<span>{m.export_file_group()}</span>
						</label>
					{/if}
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" class="radio" value="object" bind:group={fileLayout} />
						<span>{m.export_file_object()}</span>
					</label>
				</div>
			</Collapsible>

			{#if volumeGroups.length > 0}
				<div class="border-surface-300-700 flex flex-col gap-0.5 rounded-md border p-2">
					<p class="text-sm font-semibold">{m.export_approx_volume()}</p>
					{#each volumeGroups as row (row.id)}
						<p class="flex justify-between text-sm">
							<span>{row.label}:</span>
							<span>{volumeFormat.format(row.volume)} ml</span>
						</p>
					{/each}
					{#if volumeGroups.length > 1}
						<p
							class="border-surface-300-700 mt-1 flex justify-between border-t pt-1 text-sm font-semibold"
						>
							<span>{m.export_volume_total()}:</span>
							<span>{volumeFormat.format(totalVolumeMl)} ml</span>
						</p>
					{/if}
					<p class="text-surface-600-400 mt-1 text-xs">{m.export_approx_volume_hint()}</p>
				</div>
			{/if}

			{#if nothingToExport}
				<p class="text-warning-600-400 text-sm">{m.export_nothing_selected()}</p>
			{/if}
			{#if exportError}
				<p class="text-error-600-400 text-sm" role="alert">{exportError}</p>
			{/if}
			<button
				class="btn preset-filled-primary-500"
				disabled={nothingToExport || exporting}
				onclick={exportModel}
			>
				<Download class="size-4" />
				{exporting ? m.export_3d_button_working() : m.export_3d_button()}
			</button>
		</div>
	</div>
</Layout>
