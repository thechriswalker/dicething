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
			c = c.lighten(0.05);
		} else {
			c = c.darken(0.05);
		}
		return c;
	});

	let ctx: ReturnType<typeof createBaseSceneAndRenderer>;

	onMount(() => {
		ctx = createBaseSceneAndRenderer(outerEl);
		ctx.renderer.domElement.classList.add(...roundedClass.split(' '));
		ctx.scene.background = new Color(bgColor.toNumber());
		sceneReady(ctx);
		return ctx.dispose;
	});
	$effect(() => {
		console.log('background changed');
		if (ctx) {
			ctx.scene.background = new Color(bgColor.toNumber());
		}
	});

	// we havea problem that the canvas doesn't shrink. so making the screen smaller doesn't resize the scene.
</script>

<div class={[classes, borderClass, roundedClass]} bind:this={outerEl}>{@render children?.()}</div>
