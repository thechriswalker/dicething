<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DeleteSetDialog from '$lib/components/delete_set/DeleteSetDialog.svelte';
	import DiceParameters from '$lib/components/dice_parameters/DiceParameters.svelte';
	import DiePreview from '$lib/components/die_preview/DiePreview.svelte';
	import Layout from '$lib/components/layout/Layout.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import type { MenuItemSubmenu } from '$lib/components/menu/menu';
	import Menu from '$lib/components/menu/Menu.svelte';
	import LegendsModal from '$lib/components/legends_modal/LegendsModal.svelte';
	import Scene from '$lib/components/scene/Scene.svelte';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import dice from '$lib/dice';
	import { isBuiltin, type Builtin } from '$lib/fonts';
	import {
		cloneLegendSet,
		diceFromJSON,
		diceToJSON,
		dieToJSON,
		getSavedLegends,
		loadLegends,
		LEGENDS_CHANGED_EVENT,
		saveSet,
		waitForSet,
		type Dice,
		type DiceSet
	} from '$lib/interfaces/storage.svelte';
	import type { LegendSet } from '$lib/utils/legends';
	import type { DieTags, FaceParams } from '$lib/interfaces/dice';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		Builder,
		engravingErrorsForBuilder,
		engravingParam,
		engravingToleranceParam,
		type EngravingError
	} from '$lib/utils/builder';
	import SetConfigModal from '$lib/components/set_config/SetConfigModal.svelte';
	import { computeLandWarning } from '$lib/utils/stability';
	import { debounce } from '$lib/utils/debounce';
	import { createHistory } from '$lib/utils/history.svelte';
	import { hoverAndClickEvents } from '$lib/utils/events';
	import { createFancyRender, createGridHelper, type SceneRenderer } from '$lib/utils/scene';
	import { download, exportSetJson } from '$lib/utils/export';
	import { event } from '$lib/utils/use_event';
	import {
		AlertTriangle,
		Box,
		DownloadIcon,
		FileBoxIcon,
		FileCode2,
		Focus,
		Frame,
		Grid3X3,
		LayoutGrid,
		PlusIcon,
		SaveIcon,
		Shapes,
		SparklesIcon,
		SquareDashed,
		Squircle,
		Trash2Icon,
		WandSparkles,
		XIcon
	} from '@lucide/svelte';
	import { Button } from 'bits-ui';
	import { mergeProps } from 'svelte-toolbelt';
	import { onDestroy, onMount } from 'svelte';
	import { type Object3D, Vector2, Vector3 } from 'three';
	import { degToRad } from 'three/src/math/MathUtils.js';

	// merge a parent trigger's props (e.g. a dialog/modal trigger) with our
	// tooltip trigger props so a single element can drive both behaviours.
	function mergeTriggerProps(parent: unknown, tip: Record<string, unknown>) {
		return mergeProps(parent as Record<string, unknown>, tip);
	}

	let { setId = '' } = page.params;
	let dieId = $derived(page.url.searchParams.get('die') ?? '');
	let renderPass = $state(0);

	// the loaded set, populated in onMount below. Declared up here because SSR
	// evaluates `$derived` eagerly at its declaration line, and several deriveds
	// (e.g. setDepth/setTolerance) read setData before that point would otherwise run.
	let setData: DiceSet | undefined = $state(undefined);

	// per-session undo/redo of the dice state (params, face params, add/remove).
	const history = createHistory(250);

	function gotoDie(id: string) {
		const p = page.url;
		if (id) {
			p.searchParams.set('die', id);
		} else {
			p.searchParams.delete('die');
		}
		goto(p.href);
	}

	// one entry per available die kind, used to render previews in the "add die"
	// picker. built once from the dice registry so each preview is stable.
	const previewDice: Array<Dice> = (Object.keys(dice) as Array<keyof typeof dice>).map((kind) => ({
		id: 'preview:' + kind,
		kind,
		parameters: {},
		face_parameters: []
	}));

	// how the "add die" picker groups its options.
	let dieGroupBy = $state<'shape' | 'number' | 'rarity'>('rarity');

	// preferred display order for shape groups; anything else sorts after these.
	const shapeOrder = ['polyhedron', 'trapezohedron', 'crystal', 'shard', 'caltrop', 'coin'];

	// rarity tiers, least to most rare. anything else sorts after these.
	const rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

	const shapeLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);
	const sidesLabel = (sides: string) => (sides === '00' ? 'D%' : 'D' + sides);
	const rarityLabel = (rarity: string) => rarity.charAt(0).toUpperCase() + rarity.slice(1);
	// "00" represents d% (100), so it sorts after d20.
	const sidesValue = (sides: string) => (sides === '00' ? 100 : Number(sides));

	const groupKey = (tags: DieTags | undefined) => {
		if (dieGroupBy === 'shape') return tags?.kind ?? 'other';
		if (dieGroupBy === 'rarity') return tags?.rarity ?? 'other';
		return tags?.sides ?? '';
	};

	const groupLabel = (key: string) => {
		if (dieGroupBy === 'shape') return shapeLabel(key);
		if (dieGroupBy === 'rarity') return rarityLabel(key);
		return sidesLabel(key);
	};

	const dieGroups = $derived.by(() => {
		const groups = new Map<string, { key: string; label: string; dice: Array<Dice> }>();
		for (const preview of previewDice) {
			const tags = dice[preview.kind].tags;
			const key = groupKey(tags);
			let group = groups.get(key);
			if (!group) {
				group = {
					key,
					label: groupLabel(key),
					dice: []
				};
				groups.set(key, group);
			}
			group.dice.push(preview);
		}
		return [...groups.values()].sort((a, b) => {
			if (dieGroupBy === 'shape') {
				const ai = shapeOrder.indexOf(a.key);
				const bi = shapeOrder.indexOf(b.key);
				return (ai === -1 ? shapeOrder.length : ai) - (bi === -1 ? shapeOrder.length : bi);
			}
			if (dieGroupBy === 'rarity') {
				const ai = rarityOrder.indexOf(a.key);
				const bi = rarityOrder.indexOf(b.key);
				return (ai === -1 ? rarityOrder.length : ai) - (bi === -1 ? rarityOrder.length : bi);
			}
			return sidesValue(a.key) - sidesValue(b.key);
		});
	});

	let addDie = (kind: keyof typeof dice) => {
		if (!setData) {
			return;
		}
		const id = crypto.randomUUID();
		// seed the user's preferred engraving defaults on newly added dice.
		const prefs = getPreferences();
		setData.dice.push({
			id,
			kind,
			parameters: {
				engraving_depth: prefs.defaultEngravingDepth,
				engraving_tolerance: prefs.defaultEngravingTolerance
			},
			string_parameters: {},
			face_parameters: []
		});
		// mirror the init effect: dice need a builder before they can be rendered.
		diceBuilders.set(id, new Builder(dice[kind], setData.legends, id));
		save(setData);
		gotoDie(id);
	};

	// the set-wide value of an engraving parameter for the set-config modal. Reports
	// the shared value when every die agrees, else the first die's value plus a
	// `mixed` flag so the UI can note that applying will unify them.
	function commonEngravingParam(key: string, fallback: number): { value: number; mixed: boolean } {
		const dice = setData?.dice ?? [];
		if (dice.length === 0) {
			return { value: fallback, mixed: false };
		}
		const first = dice[0].parameters[key] ?? fallback;
		const mixed = dice.some((d) => (d.parameters[key] ?? fallback) !== first);
		return { value: first, mixed };
	}
	let setDepth = $derived(commonEngravingParam(engravingParam.id, engravingParam.defaultValue));
	let setTolerance = $derived(
		commonEngravingParam(engravingToleranceParam.id, engravingToleranceParam.defaultValue)
	);

	// apply one engraving value to every die in the set (the set-config modal).
	// per-die overrides are written into each die's serialised parameters, so the
	// choice travels with an exported set rather than depending on local defaults.
	function setEngravingForAllDice(key: string, value: number) {
		if (!setData) {
			return;
		}
		for (const d of setData.dice) {
			d.parameters[key] = value;
		}
		save(setData);
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
			save(setData);
		}
	};

	// need to load the set by id, or 404 if it doesn't exist.
	onMount(async () => {
		setData = await waitForSet(setId);
		if (setData) {
			// legacy sets may predate the engraving params; make them explicit so they
			// serialise (and survive export/import) rather than silently falling back
			// to whatever defaults the importing machine happens to have.
			const prefs = getPreferences();
			for (const d of setData.dice) {
				d.parameters[engravingParam.id] ??= prefs.defaultEngravingDepth;
				d.parameters[engravingToleranceParam.id] ??= prefs.defaultEngravingTolerance;
			}
			// seed the undo stack with the loaded state as the baseline.
			history.reset(diceToJSON(setData.dice));
			if (setData.dice.length === 0 && dieId !== '') {
				gotoDie('');
			} else if (setData.dice.length > 0 && setData.dice.findIndex((d) => d.id === dieId) === -1) {
				gotoDie(setData.dice[0].id);
			}
		} else {
			goto('/dice');
		}
	});

	let ctx = $state<SceneRenderer>();

	let fancyRender = $state<ReturnType<typeof createFancyRender>>();
	let fancy = $state(false);
	function toggleFancy() {
		fancy = !fancy;
		fancyRender?.setEnabled(fancy);
	}
	// keep the current die's materials in sync with the fancy toggle, including
	// when switching to a different die.
	$effect(() => {
		currentBuilder?.setFancy(fancy && fancyRender ? fancyRender.material : undefined);
	});

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

	// captured at scene mount so camera transitions can restore the base zoom.
	// svelte-ignore non_reactive_update
	let baseZoom = 1;

	// smooth ease-in-out (cubic) shared by the camera transition.
	const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

	const CAMERA_TRANSITION_MS = 1000;

	// active camera tween, stepped each frame in onBeforeRender.
	let camTween: {
		startPos: Vector3;
		endPos: Vector3;
		startUp: Vector3;
		endUp: Vector3;
		startTarget: Vector3;
		endTarget: Vector3;
		startZoom: number;
		endZoom: number;
		start: number;
	} | null = null;

	function animateCameraTo(endPos: Vector3, endUp: Vector3, endTarget: Vector3, endZoom: number) {
		if (!ctx) return;
		camTween = {
			startPos: ctx.camera.position.clone(),
			endPos: endPos.clone(),
			startUp: ctx.camera.up.clone(),
			endUp: endUp.clone(),
			startTarget: ctx.controls.target.clone(),
			endTarget: endTarget.clone(),
			startZoom: ctx.camera.zoom,
			endZoom,
			start: performance.now()
		};
	}

	function stepCameraTween() {
		if (!camTween || !ctx) return;
		const t = Math.min(1, (performance.now() - camTween.start) / CAMERA_TRANSITION_MS);
		const e = easeInOut(t);
		ctx.camera.position.lerpVectors(camTween.startPos, camTween.endPos, e);
		ctx.camera.up.lerpVectors(camTween.startUp, camTween.endUp, e).normalize();
		ctx.controls.target.lerpVectors(camTween.startTarget, camTween.endTarget, e);
		ctx.camera.zoom = camTween.startZoom + (camTween.endZoom - camTween.startZoom) * e;
		ctx.camera.updateProjectionMatrix();
		if (t >= 1) {
			camTween = null;
		}
	}

	// the camera position/up used to "look at" a given face (matches lookAtFace).
	function faceCameraState(idx: number): { pos: Vector3; up: Vector3 } {
		const pos = new Vector3(0, 10, 40);
		const up = new Vector3(0, 1, 0);
		const face = currentBuilder?.getFaces()[idx];
		if (face) {
			const q = face.transform.rotation;
			pos.applyQuaternion(q);
			up.applyQuaternion(q).normalize();
		}
		return { pos, up };
	}

	// inline editing of the set name in the header. a draft holds the in-progress
	// value so escape can cancel without touching the saved model.
	let editingName = $state(false);
	let nameDraft = $state('');
	let nameInput = $state<HTMLInputElement>();
	function startEditName() {
		if (!setData) {
			return;
		}
		nameDraft = setData.name;
		editingName = true;
		// focus + select once the input has rendered.
		setTimeout(() => {
			nameInput?.focus();
			nameInput?.select();
		});
	}
	function commitName() {
		if (!editingName) {
			return;
		}
		editingName = false;
		if (setData) {
			const name = nameDraft.trim();
			if (name && name !== setData.name) {
				setData.name = name;
				saveSet(setData);
			}
		}
	}
	function cancelEditName() {
		editingName = false;
	}
	function onNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitName();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEditName();
		}
	}

	let saving = $state(false);
	const save = (data: DiceSet) => {
		saving = true;
		debounceSave(data);
	};
	const debounceSave = debounce(250, (data: DiceSet) => {
		saveSet(data);
		// record the settled state for undo/redo. the apply path marks the next
		// push as suppressed so undo/redo never records itself.
		history.push(diceToJSON(data.dice));
		saving = false;
	});
	const sceneReady = (_ctx: SceneRenderer) => {
		// this is only called on Scene mount, and not reactive
		// use it to set up the scene window, but not
		// to use the reactiveProps directly.
		ctx = _ctx;
		fancyRender = createFancyRender(_ctx);
		ctx.camera.position.copy(camInitialPos);
		const camZoom = ctx.camera.zoom;
		baseZoom = camZoom;
		const camRot = ctx.camera.rotation.clone();
		resetCamera = () => {
			_ctx.controls.reset();
			_ctx.camera.position.copy(camInitialPos);
			_ctx.camera.zoom = camZoom;
			_ctx.camera.rotation.copy(camRot);
		};
		ctx.scene.add(gridHelper);
		ctx.onBeforeRender(() => {
			currentBuilder?.update();
			stepCameraTween();
		});
		ctx.render();
	};

	$effect(() => {
		if (ctx && currentBuilder) {
			return hoverAndClickEvents(
				ctx.renderer.domElement,
				ctx.camera,
				currentBuilder.diceGroup,
				(ev) => {
					// don't hover-highlight faces hidden from the UI (e.g. coin rim).
					if (isHiddenFace(ev.face)) {
						ctx?.setSecondarySeletedItems([]);
						return;
					}
					// skip already-selected faces: the primary outline already marks
					// them, so a hover outline would just double up on top.
					if (targetFaces.includes(ev.face)) {
						ctx?.setSecondarySeletedItems([]);
						return;
					}
					ctx?.setSecondarySeletedItems(currentBuilder?.getOutlineObjects(ev.face) ?? []);
				},
				(ev) => {
					if (ev.dice !== dieId) {
						return;
					}
					// hidden faces aren't selectable/editable.
					if (isHiddenFace(ev.face)) {
						return;
					}
					if (formatPaintMode) {
						paintFace(ev.face);
						return;
					}
					if (ev._shift) {
						toggleFaceSelection(ev.face);
					} else if (selectMode !== 'single' || selectedFace !== ev.face) {
						// plain click → single select.
						selectMode = 'single';
						selectedFaces = [];
						selectedFace = ev.face;
						lookAtFace(selectedFace);
					} else {
						// re-clicking the already-selected face: the selection didn't
						// change, but the user is asking to see its controls, so nudge
						// the parameters panel to (re)open the face section.
						focusFaceRequest++;
					}
				}
			);
		}
	});

	// faces flagged `hidden` (e.g. the coin's rim segments) are part of the
	// geometry but must never be selected or edited from the UI.
	function isHiddenFace(idx: number): boolean {
		return !!currentBuilder?.getFaces()[idx]?.hidden;
	}

	function lookAtFace(idx: number) {
		if (explodeMode) {
			// in the flat view there's no per-face orientation; keep looking at the plane.
			animateCameraTo(new Vector3(0, 0, 100), new Vector3(0, 1, 0), new Vector3(0, 0, 0), baseZoom);
			return;
		}
		const { pos, up } = faceCameraState(idx);
		animateCameraTo(pos, up, new Vector3(0, 0, 0), baseZoom);
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

	// per-die engraving errors: faces whose legend won't engrave and would
	// therefore export blank/broken. recomputed off the render path (debounced)
	// so dragging a slider doesn't rebuild every die every frame. keyed by die id
	// and surfaced in the preview-row tooltip + a warning badge.
	let dieEngravingErrors = $state<Record<string, Array<EngravingError>>>({});
	// per-die "may land on an inconclusive face" warning (see stability.ts).
	// depends only on the die geometry, but is recomputed in the same debounced
	// pass as the engraving errors and surfaced in the same tooltip/badge.
	let dieLandWarnings = $state<Record<string, boolean>>({});
	// cached builders for the off-screen engraving-error check, one per die id.
	// reused across recomputes so we don't reinstantiate (and fully rebuild) every
	// die on every edit; only dice whose inputs changed get rebuilt. kept separate
	// from `diceBuilders` so checking a die never disturbs the on-screen (possibly
	// exploded) scene builder. cleared on unmount.
	const errorBuilders = new Map<string, Builder>();
	// per-die signature of the inputs the engraving check depends on, so we can
	// skip dice that didn't change. a legend-set swap invalidates every die.
	const lastEngravingSig = new Map<string, string>();
	let lastEngravingLegendsId: string | undefined;
	const recomputeEngravingErrors = () => {
		if (!setData) {
			return;
		}
		const legends = setData.legends;
		// a legend change can flip any die's faces between engraving/blank, so it
		// forces a recompute of every die; a die edit only affects that one die.
		const legendsChanged = legends.id !== lastEngravingLegendsId;
		lastEngravingLegendsId = legends.id;
		const next: Record<string, Array<EngravingError>> = {};
		const nextLand: Record<string, boolean> = {};
		const liveIds = new Set<string>();
		for (const d of setData.dice) {
			liveIds.add(d.id);
			const model = dice[d.kind];
			if (!model) {
				continue;
			}
			const sig = dieToJSON(d);
			// reuse the previous pass's result for a die that didn't change.
			if (!legendsChanged && lastEngravingSig.get(d.id) === sig && d.id in dieEngravingErrors) {
				next[d.id] = dieEngravingErrors[d.id];
				nextLand[d.id] = dieLandWarnings[d.id] ?? false;
				continue;
			}
			lastEngravingSig.set(d.id, sig);
			let builder = errorBuilders.get(d.id);
			if (!builder) {
				builder = new Builder(model, legends, d.id);
				errorBuilders.set(d.id, builder);
			} else if (legendsChanged) {
				builder.reloadLegends(legends);
			}
			next[d.id] = engravingErrorsForBuilder(builder, d);
			nextLand[d.id] = computeLandWarning(model, d.parameters, d.string_parameters ?? {});
		}
		// forget cached builders/signatures for dice that were removed.
		for (const id of [...errorBuilders.keys()]) {
			if (!liveIds.has(id)) {
				errorBuilders.delete(id);
				lastEngravingSig.delete(id);
			}
		}
		dieEngravingErrors = next;
		dieLandWarnings = nextLand;
	};
	// drop the cached error-check builders (and the scene builders) when leaving
	// the editor so their geometries can be collected rather than lingering.
	onDestroy(() => {
		errorBuilders.clear();
		lastEngravingSig.clear();
		diceBuilders.clear();
	});
	const debouncedRecomputeErrors = debounce<void>(300, recomputeEngravingErrors);
	// signature of everything the engraving check depends on, so the effect
	// re-runs on any param/legend change.
	let engravingSig = $derived.by(() => {
		if (!setData) {
			return '';
		}
		return JSON.stringify(diceToJSON(setData.dice)) + '|' + setData.legends.id;
	});
	$effect(() => {
		engravingSig;
		debouncedRecomputeErrors();
	});

	let init = false;
	$effect(() => {
		if (setData && ctx && !init) {
			init = true;
			console.log('init', setData);
			for (let i = 0; i < setData.dice.length; i++) {
				const d = setData.dice[i];
				// ensure the (optional) string-parameter channel exists so it can be
				// two-way bound and mutated by the parameter UI.
				d.string_parameters ??= {};
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
					renderPass = builder.build(
						{ ...d.parameters },
						d.face_parameters.slice(),
						{ explode: explodeMode },
						{ ...d.string_parameters }
					);
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
				if (builder && ctx && setData) {
					const d = setData?.dice.find((x) => x.id === dieId)!;
					d.string_parameters ??= {};
					console.log('rendering on change', dieId, ctx.scene);
					currentBuilder?.changeLegends(setData!.legends);
					renderPass = builder.build(
						{ ...d.parameters },
						d.face_parameters.slice(),
						{ explode: explodeMode },
						{ ...d.string_parameters }
					);
					save(setData); // ensure we save!
					const updated = dieId != renderedDice;
					renderedDice = dieId;
					currentBuilder = builder;
					if (updated) {
						selectMode = 'single';
						selectedFace = 0;
						selectedFaces = [];
						console.log('dice changed');
						resetCamera();
						ctx.scene.add(builder.diceGroup);
					}
					setTimeout(() => highlightSelectedFace());
				}
			}
		}
	});

	// React to legend set edits (from the legend editor route/modal, or another
	// tab). When the set currently in use changes, reload its (new) contents and
	// re-engrave the dice. Mirrors the light/dark sync pattern.
	$effect(() => {
		const handler = async (e: Event) => {
			const id = (e as CustomEvent<string>).detail;
			if (!setData || setData.legends.id !== id) {
				return;
			}
			const fresh = await loadLegends(id);
			setData.legends = fresh;
			for (const b of diceBuilders.values()) {
				b.reloadLegends(fresh);
			}
			if (currentBuilder && dieId) {
				const d = setData.dice.find((x) => x.id === dieId);
				if (d) {
					d.string_parameters ??= {};
					renderPass = currentBuilder.build(
						{ ...d.parameters },
						d.face_parameters.slice(),
						{ explode: explodeMode },
						{ ...d.string_parameters }
					);
				}
			}
		};
		window.addEventListener(LEGENDS_CHANGED_EVENT, handler);
		return () => window.removeEventListener(LEGENDS_CHANGED_EVENT, handler);
	});

	// keep the builders map consistent with the current dice after an undo/redo
	// that may have added or removed dice (mirrors addDie/removeDie cleanup).
	function reconcileBuilders() {
		if (!setData) {
			return;
		}
		for (const d of setData.dice) {
			if (!diceBuilders.has(d.id)) {
				diceBuilders.set(d.id, new Builder(dice[d.kind], setData.legends, d.id));
			}
		}
		for (const id of [...diceBuilders.keys()]) {
			if (!setData.dice.find((d) => d.id === id)) {
				const g = diceBuilders.get(id)?.diceGroup;
				if (g) {
					ctx?.scene.remove(g);
				}
				diceBuilders.delete(id);
			}
		}
	}

	function applySnapshot(snap: string) {
		if (!setData) {
			return;
		}
		// the resulting save would otherwise record this restored state again.
		history.markApplying();
		// reassigning the array re-runs the render effect and rebuilds the die.
		setData.dice = diceFromJSON(snap);
		reconcileBuilders();
		// if the focused die no longer exists, fall back to the first one.
		if (dieId && !setData.dice.find((d) => d.id === dieId)) {
			gotoDie(setData.dice[0]?.id ?? '');
		}
		save(setData);
	}

	function doUndo() {
		// commit any in-flight edit first so it becomes its own entry to step back from.
		debounceSave.flush();
		const snap = history.undo();
		if (snap !== undefined) {
			applySnapshot(snap);
		}
	}

	function doRedo() {
		debounceSave.flush();
		const snap = history.redo();
		if (snap !== undefined) {
			applySnapshot(snap);
		}
	}

	$effect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && formatPaintMode) {
				e.preventDefault();
				exitFormatPaint();
				return;
			}
			if (handleFaceShortcut(e)) {
				return;
			}
			if (!(e.metaKey || e.ctrlKey)) {
				return;
			}
			if (targetHandlesKeys(e)) {
				return;
			}
			const key = e.key.toLowerCase();
			if (key === 'z' && !e.shiftKey) {
				e.preventDefault();
				doUndo();
			} else if ((key === 'z' && e.shiftKey) || key === 'y') {
				e.preventDefault();
				doRedo();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	const gridHelper = createGridHelper(50);
	let gridVisible = $state(true);
	function toggleGridHelper() {
		gridVisible = !gridVisible;
	}

	// outline of the available legend area (face fit-shape inset by the engraving
	// tolerance) on every die. A design aid, always available in the editor.
	let legendAreaVisible = $state(false);
	$effect(() => {
		// re-apply when the active die changes so freshly-built builders pick it up.
		currentBuilder;
		renderPass;
		const glow: Object3D[] = [];
		const glowError: Object3D[] = [];
		for (const b of diceBuilders.values()) {
			b.setLegendAreaVisible(legendAreaVisible);
			if (legendAreaVisible) {
				glow.push(...b.getLegendAreaGlowObjects());
				glowError.push(...b.getLegendAreaGlowErrorObjects());
			}
		}
		// feed the invisible fills into the lime (ok) and red (bad) glow passes.
		ctx?.setLegendAreaItems(glow);
		ctx?.setLegendAreaErrorItems(glowError);
	});

	// developer-mode wireframe toggle for the scene (shown only in developer mode).
	const prefs = getPreferences();
	let devMode = $derived(prefs.developerMode);
	let wireframeOn = $state(false);
	$effect(() => {
		// turning developer mode off also clears the wireframe.
		if (!devMode && wireframeOn) {
			wireframeOn = false;
		}
		ctx?.setWireframe(wireframeOn);
	});
	$effect(() => {
		const show = gridVisible && !explodeMode;
		if (!show) {
			ctx?.scene.remove(gridHelper);
		} else {
			ctx?.scene.add(gridHelper);
		}
	});

	// face selection has three modes:
	// - 'single': one face selected (selectedFace), sliders edit that face.
	// - 'multi': several faces selected (selectedFaces), sliders edit all of them.
	// - 'none': nothing selected, no per-face controls.
	// selectedFace is also the "primary" face used to aim the camera.
	type SelectMode = 'single' | 'multi' | 'none';
	let selectMode = $state<SelectMode>('single');
	let selectedFace = $state(0);
	let selectedFaces = $state<number[]>([]);
	// bumped whenever the user re-clicks the already-selected face, signalling the
	// parameters panel to (re)open the face section even though nothing changed.
	let focusFaceRequest = $state(0);

	// the set of faces edits currently apply to / are highlighted.
	let targetFaces = $derived.by(() => {
		if (selectMode === 'multi') return selectedFaces;
		if (selectMode === 'single' && selectedFace >= 0) return [selectedFace];
		return [];
	});

	$effect(() => {
		highlightSelectedFace();
	});

	function highlightSelectedFace() {
		ctx?.setPrimarySelectedItems(
			targetFaces.flatMap((f) => currentBuilder?.getOutlineObjects(f) ?? [])
		);
	}

	// --- format painter ---------------------------------------------------
	// while active, clicking a face copies the captured configuration (all face
	// params except the legend) onto it. other parameter editing is disabled and
	// undo/redo is clamped to the operations made since the mode was entered.
	let formatPaintMode = $state(false);
	let formatPaintSource = $state<FaceParams | undefined>(undefined);

	// paintbrush mouse cursor for format-paint mode: the lucide "paintbrush-vertical"
	// icon as an SVG data-uri, drawn with a white halo behind a dark stroke so it
	// reads on both light and dark scene backgrounds. hotspot at the brush tip
	// (bottom-centre). built once at module scope so it isn't re-encoded per render.
	const paintCursor = (() => {
		const paths = [
			'M10 2v2',
			'M14 2v4',
			'M17 2a1 1 0 0 1 1 1v9H6V3a1 1 0 0 1 1-1z',
			'M6 12a1 1 0 0 0-1 1v1a2 2 0 0 0 2 2h2a1 1 0 0 1 1 1v2.9a2 2 0 1 0 4 0V17a1 1 0 0 1 1-1h2a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1'
		]
			.map((d) => `<path d="${d}"/>`)
			.join('');
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ` +
			`fill="none" stroke-linecap="round" stroke-linejoin="round">` +
			`<g stroke="#ffffff" stroke-width="3.5">${paths}</g>` +
			`<g stroke="#1a1a1a" stroke-width="2">${paths}</g>` +
			`</svg>`;
		return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 22, crosshair`;
	})();

	// swap the 3D canvas cursor to the paintbrush while format-painting.
	$effect(() => {
		const canvas = ctx?.renderer.domElement;
		if (!canvas) {
			return;
		}
		canvas.style.cursor = formatPaintMode ? paintCursor : '';
	});

	// copy a face's params, dropping the legend and cloning the offset vector.
	function copyFaceParamsExcludingLegend(fp: FaceParams | undefined): FaceParams {
		return {
			scale: fp?.scale,
			offset: fp?.offset?.clone(),
			rotation: fp?.rotation,
			extraDepth: fp?.extraDepth
		};
	}

	// the face we copy a configuration from (the primary/displayed face).
	function currentSourceFace(): number {
		return targetFaces.length > 0 ? targetFaces[0] : -1;
	}

	function currentDie(): Dice | undefined {
		return setData?.dice.find((x) => x.id === dieId);
	}

	// write the given params onto a face, preserving that face's existing legend.
	function paintFaceParams(die: Dice, face: number, source: FaceParams) {
		const existing = die.face_parameters[face] ?? {};
		die.face_parameters[face] = {
			legend: existing.legend,
			scale: source.scale,
			offset: source.offset?.clone(),
			rotation: source.rotation,
			extraDepth: source.extraDepth
		};
	}

	function applyCurrentToAllFaces() {
		const die = currentDie();
		const face = currentSourceFace();
		if (!setData || !die || face < 0) {
			return;
		}
		const source = copyFaceParamsExcludingLegend(die.face_parameters[face]);
		const faceCount = currentBuilder?.getFaces().length ?? 0;
		for (let i = 0; i < faceCount; i++) {
			if (isHiddenFace(i)) {
				continue;
			}
			paintFaceParams(die, i, source);
		}
		save(setData);
	}

	function enterFormatPaint() {
		const die = currentDie();
		const face = currentSourceFace();
		if (!die || face < 0) {
			return;
		}
		// settle any in-flight edit so it isn't lumped into the first paint.
		debounceSave.flush();
		formatPaintSource = copyFaceParamsExcludingLegend(die.face_parameters[face]);
		formatPaintMode = true;
		// clamp undo so we can only step back over paint ops while in this mode.
		history.setFloor();
	}

	function exitFormatPaint() {
		if (!formatPaintMode) {
			return;
		}
		debounceSave.flush();
		formatPaintMode = false;
		formatPaintSource = undefined;
		history.releaseFloor();
	}

	function paintFace(face: number) {
		const die = currentDie();
		if (!setData || !die || !formatPaintSource) {
			return;
		}
		paintFaceParams(die, face, formatPaintSource);
		save(setData);
	}

	// set every selected face to the primary face's params (excluding legend), so
	// a multi-selection stops holding per-face deltas and shares one configuration.
	function synchroniseSelectedFaces() {
		const die = currentDie();
		const face = currentSourceFace();
		if (!setData || !die || face < 0 || targetFaces.length === 0) {
			return;
		}
		const source = copyFaceParamsExcludingLegend(die.face_parameters[face]);
		for (const i of targetFaces) {
			paintFaceParams(die, i, source);
		}
		save(setData);
	}

	// --- keyboard nudging of the selected face(s) ------------------------
	// arrows nudge the x/y offset; shift+left/right rotates; shift+up/down scales.
	// step sizes / clamps mirror the slider ranges in DiceParameters.
	const NUDGE_OFFSET = 0.5;
	const NUDGE_ROTATION_DEG = 1;
	const NUDGE_SCALE = 0.05;
	const OFFSET_LIMIT = 20;
	const SCALE_MIN = 0.1;
	const SCALE_MAX = 5;

	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

	function nudgeSelectedFaces(opts: {
		dx?: number;
		dy?: number;
		dRotDeg?: number;
		dScale?: number;
	}) {
		const die = currentDie();
		if (!setData || !die || targetFaces.length === 0) {
			return;
		}
		for (const i of targetFaces) {
			const p = die.face_parameters[i] ?? {};
			if (opts.dx || opts.dy) {
				const offset = p.offset?.clone() ?? new Vector2(0, 0);
				offset.setX(clamp(offset.x + (opts.dx ?? 0), -OFFSET_LIMIT, OFFSET_LIMIT));
				offset.setY(clamp(offset.y + (opts.dy ?? 0), -OFFSET_LIMIT, OFFSET_LIMIT));
				p.offset = offset;
			}
			if (opts.dRotDeg) {
				p.rotation = clamp((p.rotation ?? 0) + degToRad(opts.dRotDeg), -Math.PI, Math.PI);
			}
			if (opts.dScale) {
				const legend = p.legend ?? currentBuilder?.getFaces()[i]?.defaultLegend;
				const def = legend ? (currentBuilder?.getDefaultScaleForLegend(legend) ?? 1) : 1;
				p.scale = clamp((p.scale ?? def) + opts.dScale, SCALE_MIN, SCALE_MAX);
			}
			die.face_parameters[i] = p;
		}
		save(setData);
	}

	// handle the arrow-key shortcuts; returns true if the event was consumed.
	// true when the focused element handles its own keyboard input, so global
	// editor shortcuts must keep their hands off. Besides text fields this covers
	// the skeleton/zag slider, whose focusable thumb is a `role="slider"` element
	// (not an `<input>`) that consumes arrow keys to change its value.
	function targetHandlesKeys(e: KeyboardEvent): boolean {
		const target = e.target as HTMLElement | null;
		if (!target) {
			return false;
		}
		return (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable ||
			target.closest('[role="slider"]') !== null
		);
	}

	function handleFaceShortcut(e: KeyboardEvent): boolean {
		if (e.metaKey || e.ctrlKey || e.altKey || formatPaintMode || targetFaces.length === 0) {
			return false;
		}
		if (targetHandlesKeys(e)) {
			return false;
		}
		const shift = e.shiftKey;
		switch (e.key) {
			case 'ArrowUp':
				nudgeSelectedFaces(shift ? { dScale: NUDGE_SCALE } : { dy: NUDGE_OFFSET });
				break;
			case 'ArrowDown':
				nudgeSelectedFaces(shift ? { dScale: -NUDGE_SCALE } : { dy: -NUDGE_OFFSET });
				break;
			case 'ArrowLeft':
				nudgeSelectedFaces(shift ? { dRotDeg: -NUDGE_ROTATION_DEG } : { dx: -NUDGE_OFFSET });
				break;
			case 'ArrowRight':
				nudgeSelectedFaces(shift ? { dRotDeg: NUDGE_ROTATION_DEG } : { dx: NUDGE_OFFSET });
				break;
			default:
				return false;
		}
		e.preventDefault();
		return true;
	}

	// shift-click on the 3d view toggles a face in/out of the selection.
	// reducing the selection on the dice itself switches tools: 1 face -> single,
	// 0 faces -> none.
	function toggleFaceSelection(face: number) {
		const set = new Set(targetFaces);
		if (set.has(face)) {
			set.delete(face);
		} else {
			set.add(face);
		}
		const next = [...set].sort((a, b) => a - b);
		if (next.length === 0) {
			selectMode = 'none';
			selectedFaces = [];
		} else if (next.length === 1) {
			selectMode = 'single';
			selectedFaces = [];
			selectedFace = next[0];
			lookAtFace(selectedFace);
		} else {
			selectMode = 'multi';
			selectedFaces = next;
			// keep the camera on the most recently toggled face.
			selectedFace = face;
			lookAtFace(face);
		}
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

	const savedLegends = getSavedLegends();

	function fontAction(b: Builtin) {
		return async () => {
			const fnt = await b.load();
			if (setData) {
				setData.legends = fnt;
				save(setData);
			}
		};
	}

	function setLegends(set: LegendSet) {
		return () => {
			if (setData) {
				setData.legends = set;
				save(setData);
			}
		};
	}

	// jump to the legend editor for the current set. Builtins are cloned first
	// (they can only be cloned, not edited in place); custom sets open directly.
	async function editOrCloneLegends() {
		if (!setData) {
			return;
		}
		const ret = '/dice/' + setId + (dieId ? '?die=' + dieId : '');
		let id = setData.legends.id;
		if (isBuiltin(id)) {
			const clone = await cloneLegendSet(setData.legends);
			setData.legends = clone;
			id = clone.id;
			saveSet(setData);
		}
		goto('/legends/' + id + '?return=' + encodeURIComponent(ret));
	}

	function exportJson() {
		if (!setData) {
			return;
		}
		const json = exportSetJson(setData, { embedLegends: 'all' });
		const name = (setData.name || 'set').replace(/[^a-z0-9-_]+/gi, '_');
		download(new Blob([json], { type: 'application/json' }), `${name}.json`);
	}

	const exportMenu: MenuItemSubmenu = {
		type: 'submenu',
		title: m.menu_export(),
		icon: DownloadIcon,
		children: [
			{
				title: m.menu_export_as_json(),
				icon: FileCode2,
				type: 'action',
				action: exportJson
			},
			{
				title: m.menu_export_as_stl(),
				icon: FileBoxIcon,
				type: 'action',
				action: () => {
					goto('/dice/' + setId + '/export');
				}
			}
		]
	};
</script>

<Layout>
	{#snippet header()}
		{#if saving}
			<SaveIcon class="size-4" />
		{/if}
		{#if editingName}
			<input
				bind:this={nameInput}
				bind:value={nameDraft}
				class="text-primary-500 h4 bg-transparent outline-none"
				onblur={commitName}
				onkeydown={onNameKeydown}
			/>
		{:else}
			<Tooltip content={m.set_name_edit_hint()} side="bottom">
				{#snippet children(props)}
					<button
						{...props}
						type="button"
						class="text-primary-500 h4 cursor-text bg-transparent"
						onclick={startEditName}
					>
						{setData?.name}
					</button>
				{/snippet}
			</Tooltip>
		{/if}
		{#if setData}
			<LegendsModal
				current={setData.legends}
				{savedLegends}
				onEdit={editOrCloneLegends}
				onSelectCustom={(set) => setLegends(set)()}
				onSelectBuiltin={(b) => fontAction(b)()}
			/>
			<SetConfigModal
				depth={setDepth.value}
				tolerance={setTolerance.value}
				depthMixed={setDepth.mixed}
				toleranceMixed={setTolerance.mixed}
				onChangeDepth={(v) => setEngravingForAllDice(engravingParam.id, v)}
				onChangeTolerance={(v) => setEngravingForAllDice(engravingToleranceParam.id, v)}
			/>
		{/if}
		<Menu data={exportMenu} submenuOnLeft></Menu>
		{#if setData}
			<DeleteSetDialog {setId} setName={setData.name} onDeleted={() => goto('/dice')}>
				{#snippet trigger(props)}
					<Tooltip content={m.delete_set_button()} side="bottom">
						{#snippet children(tipProps)}
							{@const merged = mergeTriggerProps(props, tipProps)}
							<button {...merged} type="button" class="btn preset-filled-error-500">
								<Trash2Icon class="size-4" />
								{m.delete_set_button()}
							</button>
						{/snippet}
					</Tooltip>
				{/snippet}
			</DeleteSetDialog>
		{/if}
	{/snippet}
	<div class="flex h-full flex-col">
		<div
			class={'flex flex-row flex-wrap items-center justify-start gap-4 pb-4' +
				(formatPaintMode ? ' opacity-50' : '')}
			inert={formatPaintMode}
		>
			{#each setData?.dice as die}
				{@const dieErrors = dieEngravingErrors[die.id] ?? []}
				{@const landWarning = dieLandWarnings[die.id] ?? false}
				{#snippet dieTip()}
					<div class="flex flex-col gap-0.5">
						<span class="font-semibold">{m.dice_name({ kind: die.kind })}</span>
						{#each dieErrors as err}
							<span class="text-error-400">
								{m.engraving_broken_for({ legend: err.legendName })}
							</span>
						{/each}
						{#if landWarning}
							<span class="max-w-60 text-amber-500">
								{m.dice_land_warning({ kind: die.kind })}
							</span>
						{/if}
					</div>
				{/snippet}
				<Tooltip content={dieTip} side="bottom">
					{#snippet children(tipProps)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
						<div
							{...tipProps}
							role="button"
							class={'transition-duration-100 hover:border-primary-500 group hover:shadow-primary-500 relative size-16 cursor-pointer rounded-md border transition-transform ease-in-out hover:scale-120 hover:shadow-md ' +
								(die.id === dieId
									? 'border-primary-500 shadow-primary-500 hover:border-primary-500 group hover:shadow-primary-500 shadow-md'
									: dieErrors.length > 0
										? 'border-error-500'
										: landWarning
											? 'border-amber-500'
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
							<!-- engraving-error badge: this die would export with one or more
							     broken faces. details are in the tooltip. -->
							{#if dieErrors.length > 0}
								<div
									class="text-error-500 absolute bottom-[-6px] left-[-6px] rounded-full bg-white"
									aria-hidden="true"
								>
									<AlertTriangle size={16} />
								</div>
							{/if}
							<!-- land warning badge: this die can come to rest on an
							     inconclusive face. details (and whether it's a defect or an
							     expected trade-off) are in the tooltip. -->
							{#if landWarning}
								<div
									class="absolute right-[-6px] bottom-[-6px] rounded-full bg-white text-amber-500"
									aria-hidden="true"
								>
									<AlertTriangle size={16} />
								</div>
							{/if}
							<DiePreview {die} legends={setData?.legends!} />
						</div>
					{/snippet}
				</Tooltip>
			{/each}
			<Modal>
				{#snippet title()}
					{m.controls_add_new_die()}
				{/snippet}
				{#snippet trigger(props)}
					<Tooltip content={m.controls_add_new_die()}>
						{#snippet children(tipProps)}
							{@const merged = mergeTriggerProps(props, tipProps)}
							<button
								{...merged}
								class="hover:border-primary-500 hover:shadow-primary-500 flex size-16 cursor-pointer items-center justify-center overflow-hidden rounded-md border text-center hover:shadow-md"
								aria-label={m.controls_add_new_die()}
							>
								<PlusIcon size={32} />
							</button>
						{/snippet}
					</Tooltip>
				{/snippet}
				{#snippet inner(close)}
					<div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
						<div class="bg-surface-100-900 sticky top-0 z-10 flex gap-2 pb-1">
							<button
								class="flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm hover:shadow-md {dieGroupBy ===
								'shape'
									? 'border-primary-500 text-primary-500'
									: ''}"
								onclick={() => (dieGroupBy = 'shape')}
							>
								<Shapes size={16} />
								{m.controls_group_by_shape()}
							</button>
							<button
								class="flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm hover:shadow-md {dieGroupBy ===
								'number'
									? 'border-primary-500 text-primary-500'
									: ''}"
								onclick={() => (dieGroupBy = 'number')}
							>
								<Squircle size={16} />
								{m.controls_group_by_number()}
							</button>
							<button
								class="flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm hover:shadow-md {dieGroupBy ===
								'rarity'
									? 'border-primary-500 text-primary-500'
									: ''}"
								onclick={() => (dieGroupBy = 'rarity')}
							>
								<WandSparkles size={16} />
								{m.controls_group_by_rarity()}
							</button>
						</div>
						{#each dieGroups as group (group.key)}
							<div class="flex flex-col gap-2">
								<h3 class="text-surface-600-400 text-sm font-semibold">{group.label}</h3>
								<div class="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
									{#each group.dice as preview (preview.kind)}
										<button
											class="hover:border-primary-500 hover:shadow-primary-500 flex cursor-pointer flex-col items-center gap-1 rounded-md border p-2 text-center hover:shadow-md"
											onclick={() => {
												addDie(preview.kind);
												close();
											}}
										>
											{#if setData}
												<DiePreview die={preview} legends={setData.legends} />
											{/if}
											<span class="text-sm">{m.dice_name({ kind: preview.kind })}</span>
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/snippet}
			</Modal>
		</div>
		<Scene class="relative w-full grow" {sceneReady}>
			<ul class="list-style-type-none absolute top-2 left-2 flex flex-col gap-2">
				<li>
					<Tooltip content={m.controls_reset_camera()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class="btn-icon preset-filled-primary-500"
								aria-label={m.controls_reset_camera()}
								onclick={() => {
									lookAtFace(selectedFace);
								}}><Focus /></Button.Root
							>
						{/snippet}
					</Tooltip>
				</li>
				<li>
					<Tooltip content={m.controls_toggle_gridlines()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class="btn-icon preset-filled-primary-500"
								aria-label={m.controls_toggle_gridlines()}
								onclick={() => {
									toggleGridHelper();
								}}><Grid3X3 /></Button.Root
							>
						{/snippet}
					</Tooltip>
				</li>
				<li>
					<Tooltip content={m.controls_toggle_legend_area()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class={'btn-icon ' +
									(legendAreaVisible ? 'preset-filled-secondary-500' : 'preset-filled-primary-500')}
								aria-label={m.controls_toggle_legend_area()}
								onclick={() => {
									legendAreaVisible = !legendAreaVisible;
								}}><SquareDashed /></Button.Root
							>
						{/snippet}
					</Tooltip>
				</li>
				{#if devMode}
					<li>
						<Tooltip content={m.controls_toggle_wireframe()} side="right">
							{#snippet children(props)}
								<Button.Root
									{...props}
									class={'btn-icon ' +
										(wireframeOn ? 'preset-filled-secondary-500' : 'preset-filled-primary-500')}
									aria-label={m.controls_toggle_wireframe()}
									onclick={() => {
										wireframeOn = !wireframeOn;
									}}><Frame /></Button.Root
								>
							{/snippet}
						</Tooltip>
					</li>
				{/if}
				<li>
					<Tooltip content={m.controls_toggle_explode_mode()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class="btn-icon preset-filled-primary-500"
								aria-label={m.controls_toggle_explode_mode()}
								onclick={() => {
									explodeMode = !explodeMode;
									currentBuilder?.setExploded(explodeMode);
									if (explodeMode) {
										// transition to looking straight at the flat plane of faces.
										animateCameraTo(
											new Vector3(0, 0, 100),
											new Vector3(0, 1, 0),
											new Vector3(0, 0, 0),
											baseZoom
										);
									} else {
										// transition back to the "look at face" direction.
										const { pos, up } = faceCameraState(selectedFace);
										animateCameraTo(pos, up, new Vector3(0, 0, 0), baseZoom);
									}
								}}
								>{#if explodeMode}<Box />{:else}<LayoutGrid />{/if}</Button.Root
							>
						{/snippet}
					</Tooltip>
				</li>
				<li>
					<Tooltip content={m.controls_toggle_fancy_render()} side="right">
						{#snippet children(props)}
							<Button.Root
								{...props}
								class={'btn-icon ' + (fancy ? 'preset-filled-primary-500' : 'preset-tonal-primary')}
								aria-label={m.controls_toggle_fancy_render()}
								aria-pressed={fancy}
								onclick={toggleFancy}><SparklesIcon /></Button.Root
							>
						{/snippet}
					</Tooltip>
				</li>
			</ul>
			{#if formatPaintMode}
				<div
					class="card preset-filled-primary-500 absolute top-2 left-1/2 flex max-w-[90%] -translate-x-1/2 items-center gap-3 p-2 shadow-md"
				>
					<span class="text-sm">{m.format_painter_toast()}</span>
					<button
						type="button"
						class="btn btn-sm preset-filled flex items-center gap-1"
						onclick={exitFormatPaint}
					>
						<XIcon size={16} />
						{m.format_painter_exit()}
					</button>
				</div>
			{/if}
			<div
				class="absolute top-2 right-2 flex flex-col {formatPaintMode ? 'hidden' : ''}"
				inert={formatPaintMode}
			>
				{#if setData && currentBuilder}
					{@const die = setData.dice!.find((x) => x.id === dieId)}
					{#if die}
						<DiceParameters
							{renderPass}
							bind:dparams={die.parameters}
							bind:sparams={die.string_parameters}
							bind:fparams={die.face_parameters}
							kind={die.kind}
							builder={currentBuilder}
							legends={setData.legends}
							landWarning={dieLandWarnings[die.id] ?? false}
							engravingErrors={dieEngravingErrors[die.id] ?? []}
							bind:selectMode
							bind:selectedFace
							bind:selectedFaces
							{focusFaceRequest}
							onChangeSelectedFace={(f) => lookAtFace(f)}
							onApplyToAll={applyCurrentToAllFaces}
							onEnterFormatPaint={enterFormatPaint}
							onSyncFaces={synchroniseSelectedFaces}
							onEditLegends={editOrCloneLegends}
							canUndo={history.canUndo}
							canRedo={history.canRedo}
							onUndo={doUndo}
							onRedo={doRedo}
						/>
					{/if}
				{/if}
			</div>
		</Scene>
	</div></Layout
>
