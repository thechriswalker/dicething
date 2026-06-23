<script lang="ts">
	import { createBaseSceneAndRenderer, type SceneRenderer } from '$lib/utils/scene';
	import { onMount, type Snippet } from 'svelte';
	import { getLightDarkContext } from '../light_switch/light_dark_context';
	import { Color } from 'three';

	interface Props {
		class?: string;
		borderClass?: string;
		roundedClass?: string;
		sceneReady: (ctx: SceneRenderer) => void;
		children?: Snippet;
	}

	let {
		class: classes = '',
		borderClass = 'border-surface-300-700 border-1',
		roundedClass = 'rounded-lg',
		sceneReady,
		children
	}: Props = $props();

	let outerEl: HTMLDivElement;

	const ldCtx = getLightDarkContext();

	let bgColor = $derived.by(() => {
		let c = ldCtx.bgColor;
		if (ldCtx.isDark) {
			c = c.lighten(0.3); // on a dark background we need to lighten a lot
		} else {
			c = c.darken(0.05);
		}
		return c.toNumber();
	});

	let ctx: ReturnType<typeof createBaseSceneAndRenderer>;

	onMount(() => {
		ctx = createBaseSceneAndRenderer(outerEl);
		ctx.renderer.domElement.classList.add(...roundedClass.split(' '));
		ctx.scene.background = new Color().setHex(bgColor);
		sceneReady(ctx);
		return ctx.dispose;
	});
	$effect(() => {
		if (ctx) {
			// we just set it as a color
			(ctx.scene.background as Color).setHex(bgColor);
		}
	});

	// we havea problem that the canvas doesn't shrink. so making the screen smaller doesn't resize the scene.
</script>

<div class={[classes, borderClass, roundedClass]} bind:this={outerEl}>{@render children?.()}</div>
