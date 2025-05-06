<script lang="ts">
	import { Github } from '@lucide/svelte';
	import { PUBLIC_APP_HOSTNAME, PUBLIC_APP_REPO_URL, PUBLIC_APP_VERSION } from '$env/static/public';
	import * as m from '$lib/paraglide/messages';
	import Logo from '$lib/components/icons/Logo.svelte';
	import LightSwitch from '$lib/components/light_switch/LightSwitch.svelte';
	import { Group, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
	import builtins, { blanks } from '$lib/fonts';
	import { Builder } from '$lib/utils/builder';
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import dice from '$lib/dice';

	let cvs: HTMLDivElement;
	let wrap: HTMLDivElement;

	let changeDice = () => {};
	let windowWidth = $state(0);
	let windowHeight = $state(0);
	if (browser) {
		let boxSize = $derived(Math.min(windowHeight, windowWidth) / 2);
		const scene = new Scene();
		const renderer = new WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(window.devicePixelRatio);
		$effect(() => {
			renderer.setSize(boxSize, boxSize);
		});
		//el.appendChild(renderer.domElement);
		let camera = new PerspectiveCamera(30, 1, 1, 500);
		camera.position.set(0, 0, 100);
		camera.lookAt(new Vector3(0, 0, 0));
		let stopRender = false;

		// we will pick a selection for the splash page.
		let models = [
			dice.icosahedron_d20,
			dice.crystal_d4,
			dice.rhombic_d6,
			dice.dodecahedron_d12,
			dice.trapezohedron_d00,
			dice.trapezohedron_d10,
			dice.trapezohedron_d8
		];
		const pickRandomModel = () => {
			const randomIndex = Math.floor(Math.random() * models.length);
			return models[randomIndex];
		};

		let model = $state(pickRandomModel());
		let nextChange = -1;
		changeDice = () => {
			clearTimeout(nextChange);
			if (stopRender) {
				return;
			}
			model = pickRandomModel();
			nextChange = setTimeout(changeDice, (1 + Math.random()) * 5000);
		};

		let font = $state(blanks);
		builtins.germania_one.load().then((f) => (font = f));

		let builder = $derived(new Builder(model, font));

		let lastBuild: Group | null = null;
		let spin1 = 0;
		let spin2 = 0;
		let boxDir = new Vector2(1, 1);

		$effect(() => {
			// all defaults
			builder.build({}, []);
			if (lastBuild) {
				scene.remove(lastBuild);
			}
			lastBuild = builder.diceGroup;
			scene.add(lastBuild);
		});

		let boxTop = 0;
		let boxLeft = 0;

		let t = Date.now();

		function render() {
			if (stopRender) {
				return;
			}
			const dt = (Date.now() - t) / 10;
			t = Date.now();
			// update box bounce direction.
			// box is boxSize square, so we keep track of top/left
			// and window size.
			if (cvs) {
				windowWidth = wrap.clientWidth;
				windowHeight = wrap.clientHeight;
				boxTop += boxDir.y * dt;
				boxLeft += boxDir.x * dt;
				if (boxTop + boxSize / 2 < 0) {
					boxDir.y = 1;
				}
				if (boxLeft + boxSize / 2 < 0) {
					boxDir.x = 1;
				}
				if (boxTop + boxSize / 2 > windowHeight) {
					boxDir.y = -1;
				}
				if (boxLeft + boxSize / 2 > windowWidth) {
					boxDir.x = -1;
				}
				cvs.style.top = boxTop + 'px';
				cvs.style.left = boxLeft + 'px';
			}
			// update dice rotation, or maybe we rotate the camera?
			if (lastBuild) {
				lastBuild.rotation.y = spin1;
				spin1 += (0.01 * dt) / 5;
				lastBuild.rotation.x = spin2;
				spin2 += (0.02 * dt) / 5;
			}
			// maybe update the dice model or the font or something as it goes...
			renderer.render(scene, camera);
			// render again
			requestAnimationFrame(render);
		}

		onMount(() => {
			nextChange = setTimeout(changeDice, (1 + Math.random()) * 5000);
			if (cvs) {
				// create a scene and renderer (we don't use the "baseRenderer and scene" as we want the control)
				// and this is different to the usual requirements.
				cvs.appendChild(renderer.domElement);
				render();
			}
		});

		onDestroy(() => {
			stopRender = true;
		});
	}
</script>

<div class="absolute z-1 h-screen w-screen overflow-hidden" bind:this={wrap}>
	<!-- these are both ignored, because this is a purely visual thing, and has no semantic meaning -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="absolute" onclick={() => changeDice()} bind:this={cvs}></div>
</div>

<div class="pointer-events-none z-10 flex h-screen items-center justify-center">
	<div
		class="card preset-glass-neutralx pointer-events-auto flex flex-col items-center justify-center p-8"
	>
		<Logo size="128" />
		<h1 class="h1 mt-4 text-6xl sm:text-8xl">{m['meta.app_name']()}</h1>
		<h2 class="h2 text-3xl sm:text-4xl">{m['meta.app_tagline']()}</h2>
		<div class="card preset-filled-secondary-500 mt-4 p-4 text-center">
			<p class="h5">{m['not_available.title']()}</p>
			<p>{m['not_available.content']()}</p>
		</div>

		<div class="my-4 flex flex-row justify-center gap-2">
			<a href={PUBLIC_APP_REPO_URL} class="btn btn-lg preset-filled-primary-500">
				<Github class="icon-text" />

				<smaller>
					v{PUBLIC_APP_VERSION}
				</smaller>
			</a>
			<!-- <a href={PUBLIC_APP_HOSTNAME} class="btn btn-lg preset-filled-primary-500"
				>{m['splash.start']()} {m['splash.early_access']()}</a
			> -->
		</div>
		<LightSwitch />
	</div>
</div>
