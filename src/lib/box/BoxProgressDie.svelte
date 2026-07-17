<script lang="ts">
	// A 3D die used as a progress indicator for the box build. It ticks from face
	// 1 to face 2 to 3 ... in ease-in-out hops with a brief pause on each, driven
	// by the discrete progress steps streamed from the box worker. The die kind is
	// chosen by the number of steps (d6/d8/d10/d12/d20) and steps are quantised
	// onto its faces, so the die acts as the bar.
	//
	// The renderer is deliberately slim (a bare Scene + WebGLRenderer + one
	// camera, no controls/composer/environment) and uses Builder.flatLegendPreview
	// like die_preview.worker — flat legend overlays, no manifold engraving.
	import { dev as buildDev } from '$app/environment';
	import { onDestroy, onMount, untrack } from 'svelte';
	import {
		Box3,
		PerspectiveCamera,
		Quaternion,
		Scene,
		Sphere,
		Vector3,
		WebGLRenderer
	} from 'three';
	import dice from '$lib/dice';
	import { Builder } from '$lib/utils/builder';
	import { defaultFont } from '$lib/fonts';
	import type { LegendSet } from '$lib/utils/legends';
	import type { BuildProgress } from './box_builder';
	import { m } from '$lib/paraglide/messages';

	// `showDevTools` defaults to the build-time dev flag, but the box page passes
	// its developer-mode preference so the panel matches the page's dev controls.
	// `decoupled` is bindable so the page can keep the indicator open (and not
	// auto-hide on completion) while a dev plays with it.
	// `decoupled` is bindable so the page can keep the indicator open while a dev
	// plays with it. `complete` tells us the build's compute has finished (so we
	// should roll down to the final face). `atFinalFace` is bound back out so the
	// page knows when the die has actually reached "1" - that's when its
	// post-completion linger should start.
	let {
		progress = null,
		showDevTools = buildDev,
		decoupled = $bindable(false),
		complete = false,
		atFinalFace = $bindable(false)
	}: {
		progress: BuildProgress | null;
		showDevTools?: boolean;
		decoupled?: boolean;
		complete?: boolean;
		atFinalFace?: boolean;
	} = $props();

	// Standard dice to use as the indicator, smallest first; pick the smallest
	// whose face count covers the step count (falling back to the d20).
	const DICE_BY_SIDES: Array<{ sides: number; kind: string }> = [
		{ sides: 6, kind: 'd6_cube' },
		{ sides: 8, kind: 'd8_trapezohedron' },
		{ sides: 10, kind: 'd10_trapezohedron' },
		{ sides: 12, kind: 'd12_dodecahedron' },
		{ sides: 20, kind: 'd20_icosahedron' }
	];

	function pickDieKind(totalSteps: number): string {
		return (DICE_BY_SIDES.find((d) => d.sides >= totalSteps) ?? DICE_BY_SIDES.at(-1)!).kind;
	}

	// the default font's legends, loaded once (so the faces show real numbers).
	let legendsPromise: Promise<LegendSet> | undefined;
	function getLegends(): Promise<LegendSet> {
		return (legendsPromise ??= defaultFont.load());
	}

	const FOV = 30;

	// --- non-reactive render/animation state -------------------------------
	let canvasEl: HTMLCanvasElement;
	let renderer: WebGLRenderer | undefined;
	let scene: Scene | undefined;
	let camera: PerspectiveCamera | undefined;
	let builder: Builder | undefined;
	let currentKind = '';
	// one target orientation per number face (rotating the die so that face points
	// at the camera).
	let faceQuats: Array<Quaternion> = [];
	const currentQuat = new Quaternion();
	// the face the die should currently be showing (index into faceQuats). The
	// animator chases this; if progress jumps ahead the die rotates straight to
	// the latest expected face, skipping the ones in between.
	let targetFace = 0;
	let currentFace = 0;
	let tween: { from: Quaternion; to: Quaternion; start: number; target: number } | undefined;
	let pauseUntil = 0;
	let rafId = 0;
	let loopRunning = false;
	// the most recent progress, captured for an async (re)build to catch up to.
	let pendingProgress: BuildProgress | null = null;

	// face-to-face hop timing: a quick ease-in-out tween then a brief hold.
	const transitionMs = 250;
	const pauseMs = 50;

	function easeInOut(t: number): number {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	function requestTick() {
		if (!loopRunning) {
			loopRunning = true;
			rafId = requestAnimationFrame(loop);
		}
	}

	function loop() {
		if (!renderer || !scene || !camera || !builder) {
			loopRunning = false;
			return;
		}
		const now = performance.now();
		if (tween) {
			const t = transitionMs > 0 ? Math.min(1, (now - tween.start) / transitionMs) : 1;
			currentQuat.slerpQuaternions(tween.from, tween.to, easeInOut(t));
			builder.diceGroup.quaternion.copy(currentQuat);
			if (t >= 1) {
				currentFace = tween.target;
				tween = undefined;
				pauseUntil = now + pauseMs;
			}
		} else if (currentFace !== targetFace && now >= pauseUntil) {
			// rotate straight to the latest expected face: a steady rolldown
			// advances targetFace one at a time (so each number is shown), but if we
			// fell behind it has jumped, and we skip to it.
			tween = {
				from: currentQuat.clone(),
				to: faceQuats[targetFace],
				start: now,
				target: targetFace
			};
		}
		renderer.render(scene, camera);
		const settled = !tween && currentFace === targetFace && now >= pauseUntil;
		const atEnd = settled && faceQuats.length > 0 && currentFace === faceQuats.length - 1;
		if (atEnd !== atFinalFace) {
			atFinalFace = atEnd;
		}
		if (!settled) {
			rafId = requestAnimationFrame(loop);
		} else {
			loopRunning = false;
		}
	}

	// Reset the die to face 0 at the start of a fresh build (step 0).
	function resetSequence() {
		targetFace = 0;
		currentFace = 0;
		tween = undefined;
		pauseUntil = 0;
		atFinalFace = false;
		if (faceQuats.length) {
			currentQuat.copy(faceQuats[0]);
			builder?.diceGroup.quaternion.copy(currentQuat);
		}
		requestTick();
	}

	// Point the die at the face this progress step maps to (the animator rolls
	// there, skipping intermediates if it has fallen behind).
	function syncToProgress(p: BuildProgress) {
		const sides = faceQuats.length;
		if (!sides) {
			return;
		}
		const target = Math.min(sides - 1, Math.max(0, Math.ceil((p.step / p.totalSteps) * sides) - 1));
		if (target > targetFace) {
			targetFace = target;
			requestTick();
		}
	}

	async function buildDie(kind: string) {
		if (!scene || !renderer || !camera) {
			return;
		}
		currentKind = kind;
		const legends = await getLegends();
		// a later (re)build may have superseded this one while we awaited.
		if (currentKind !== kind || !scene) {
			return;
		}
		const model = dice[kind as keyof typeof dice];
		if (!model) {
			return;
		}
		if (builder) {
			scene.remove(builder.diceGroup);
			builder.diceGroup.traverse((o) => {
				const mesh = o as { geometry?: { dispose?: () => void } };
				mesh.geometry?.dispose?.();
			});
		}
		const next = new Builder(model, legends);
		// same cheap path as die_preview.worker: flat legend overlays, no manifold.
		next.flatLegendPreview = true;
		next.build({}, [], { explode: false });
		builder = next;

		faceQuats = next
			.getFaces()
			.filter((f) => f.isNumberFace)
			.map((f) => {
				const rot = f.transform.rotation;
				const normal = new Vector3(0, 0, 1).applyQuaternion(rot).normalize();
				// first point the face at the camera (+Z)...
				const q0 = new Quaternion().setFromUnitVectors(normal, new Vector3(0, 0, 1));
				// ...then spin about the camera axis so the legend's "up" (the face's
				// local +Y) lands on screen-up (+Y), i.e. the number reads upright.
				// setFromUnitVectors leaves an arbitrary in-plane rotation otherwise.
				const up = new Vector3(0, 1, 0).applyQuaternion(rot).applyQuaternion(q0);
				const spin = new Quaternion().setFromAxisAngle(
					new Vector3(0, 0, 1),
					Math.atan2(up.x, up.y)
				);
				return spin.multiply(q0);
			})
			// reverse so the die counts DOWN (high face first, ticking toward 1) as
			// the build progresses - reads better than a count-up.
			.reverse();

		// frame the camera from the die's bounding sphere (at rest orientation).
		next.diceGroup.quaternion.identity();
		const box = new Box3().setFromObject(next.diceGroup);
		const sphere = box.getBoundingSphere(new Sphere());
		const radius = sphere.radius || 10;
		const dist = (radius / Math.sin((FOV * Math.PI) / 180 / 2)) * 1.15;
		camera.position.set(0, 0, dist);
		camera.lookAt(0, 0, 0);

		scene.add(next.diceGroup);

		// snap to face 0 and catch up to wherever progress currently is.
		resetSequence();
		if (!decoupled) {
			if (complete) {
				// the build already finished while the die was being built: roll
				// straight to the final face.
				targetFace = faceQuats.length - 1;
			} else if (pendingProgress) {
				syncToProgress(pendingProgress);
			}
			requestTick();
		}
	}

	// (re)build the die when the chosen kind changes.
	$effect(() => {
		const p = progress;
		const desiredKind = p ? pickDieKind(p.totalSteps) : '';
		if (desiredKind && desiredKind !== untrack(() => currentKind)) {
			buildDie(desiredKind);
		}
	});

	// advance the die as real progress arrives (unless the dev panel decoupled it).
	$effect(() => {
		const p = progress;
		if (!p) {
			return;
		}
		pendingProgress = p;
		untrack(() => {
			if (decoupled) {
				return;
			}
			if (p.step === 0) {
				resetSequence();
			}
			syncToProgress(p);
		});
	});

	// once the build's compute is done, always roll the die down to the final
	// face ("1"), even if a progress tick was missed or the die was decoupled and
	// then re-coupled.
	$effect(() => {
		const done = complete;
		const dec = decoupled;
		if (done && !dec) {
			untrack(() => {
				const sides = faceQuats.length;
				if (sides) {
					targetFace = sides - 1;
					requestTick();
				}
			});
		}
	});

	// --- dev controls ------------------------------------------------------
	function manualStep(dir: 1 | -1) {
		const sides = faceQuats.length;
		if (!sides) {
			return;
		}
		targetFace = Math.min(sides - 1, Math.max(0, (tween ? tween.target : targetFace) + dir));
		requestTick();
	}

	onMount(() => {
		scene = new Scene();
		// the die uses an unlit MeshNormalMaterial, so no lights are needed.
		renderer = new WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.setSize(160, 160, false);
		camera = new PerspectiveCamera(FOV, 1, 1, 1000);
		camera.position.set(0, 0, 60);

		// build immediately if we already have a progress tick.
		if (progress) {
			buildDie(pickDieKind(progress.totalSteps));
		}
	});

	onDestroy(() => {
		cancelAnimationFrame(rafId);
		loopRunning = false;
		if (builder && scene) {
			scene.remove(builder.diceGroup);
		}
		renderer?.dispose();
		renderer = undefined;
		scene = undefined;
		camera = undefined;
		builder = undefined;
	});

	const label = $derived.by(() => {
		const p = progress;
		if (!p) {
			return m.boxes_rendering();
		}
		// callers (e.g. export) can supply a ready-made status string.
		if (p.label) {
			return p.label;
		}
		if (p.step === 0) {
			return m.boxes_rendering();
		}
		if (p.phase === 'base') {
			return m.boxes_cutting_base();
		}
		if (p.phase === 'lid') {
			return m.boxes_cutting_lid();
		}
		// prepare phase: dice count is the step total minus the base + lid steps.
		return m.boxes_preparing_die({ k: p.step, n: Math.max(1, p.totalSteps - 2) });
	});
</script>

<div class="card preset-glass-surface flex flex-col items-center gap-1 p-2">
	<canvas class="progress-die" bind:this={canvasEl}></canvas>
	<div class="text-center text-sm">{label}</div>
	{#if progress}
		<div class="text-surface-600-300 text-xs">{progress.step} / {progress.totalSteps}</div>
	{/if}

	{#if showDevTools}
		<div class="border-surface-300-700 mt-1 flex flex-col gap-1 border-t pt-1 text-xs">
			<label class="flex items-center gap-1">
				<input type="checkbox" bind:checked={decoupled} />
				<span>Decouple from progress</span>
			</label>
			<div class="flex items-center gap-1">
				<button class="btn btn-sm preset-tonal-primary" onclick={() => manualStep(-1)}>Prev</button>
				<button class="btn btn-sm preset-tonal-primary" onclick={() => manualStep(1)}>Next</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.progress-die {
		width: 160px;
		height: 160px;
	}
</style>
