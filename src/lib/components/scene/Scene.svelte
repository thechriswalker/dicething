<script lang="ts">
	import { createBaseSceneAndRenderer, type SceneRenderer } from '$lib/utils/scene';
	import { onMount, type Snippet } from 'svelte';

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

	onMount(() => {
		const ctx = createBaseSceneAndRenderer(outerEl);
		ctx.renderer.domElement.classList.add(...roundedClass.split(' '));
		sceneReady(ctx);
		return ctx.dispose;
	});

	// we havea problem that the canvas doesn't shrink. so making the screen smaller doesn't resize the scene.
</script>

<div class={[classes, borderClass, roundedClass]} bind:this={outerEl}>{@render children?.()}</div>
