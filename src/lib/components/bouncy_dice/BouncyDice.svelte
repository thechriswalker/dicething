<script lang="ts">
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
		let nextChange: NodeJS.Timeout = -1 as any;
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
		let anim: number;
		let visible = true;
		let contextLost = false;
		function render() {
			if (stopRender || !visible || contextLost) {
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
			anim = requestAnimationFrame(render);
		}

		// need to subscribe to the page-visibility API, to see if our requestAnimationFrame happened.
		// we might as well cancel the animation frame if we're not visible.
		document.addEventListener('visibilitychange', () => {
			visible = !document.hidden;
			if (!visible) {
				if (anim) {
					cancelAnimationFrame(anim);
				}
			} else {
				t = Date.now();
				anim = requestAnimationFrame(render);
			}
		});

		onMount(() => {
			nextChange = setTimeout(changeDice, (1 + Math.random()) * 5000);
			if (cvs) {
				// create a scene and renderer (we don't use the "baseRenderer and scene" as we want the control)
				// and this is different to the usual requirements.
				cvs.appendChild(renderer.domElement);
				renderer.domElement.addEventListener(
					'webglcontextlost',
					function (event) {
						event.preventDefault();
						contextLost = true;
						// animationID would have been set by your call to requestAnimationFrame
						if (anim) {
							cancelAnimationFrame(anim);
						}
					},
					false
				);

				renderer.domElement.addEventListener(
					'webglcontextrestored',
					function (event) {
						// Do something
						contextLost = false;
						if (visible) {
							t = Date.now();
							anim = requestAnimationFrame(render);
						}
					},
					false
				);
				render();
			}
		});

		window.triggerContextLoss = () => renderer.forceContextLoss();
		window.triggerContextRestore = () => renderer.forceContextRestore();

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
