<script lang="ts">
	import { createBaseSceneAndRenderer, type SceneRenderer } from '$lib/utils/scene';
	import { onMount, type Snippet } from 'svelte';
	import { getLightDarkContext } from '../light_switch/light_dark_context';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
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
	const prefs = getPreferences();

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

	// developer mode shows the FPS/stats panel automatically. Wireframe is a manual
	// per-view toggle (driven by the scene bar), not forced on here.
	$effect(() => {
		if (ctx) {
			ctx.setStatsVisible(prefs.developerMode);
		}
	});

</script>

<!-- min-h-0 + overflow-hidden: flex grow defaults to min-height:auto (canvas bitmap),
     which prevents shrink-on-window-resize; scene.ts ResizeObserver then never fires. -->
<div
	class={[classes, borderClass, roundedClass, 'relative min-h-0 min-w-0 overflow-hidden']}
	bind:this={outerEl}
>
	{@render children?.()}
</div>
