<script lang="ts">
	import { createBaseSceneAndRenderer, type SceneRenderer } from '$lib/utils/scene';
	import { onMount } from 'svelte';

	interface Props {
		class?: string;
		borderClass?: string;
		roundedClass?: string;
		sceneReady: (ctx: SceneRenderer) => void;
	}

	let {
		class: classes = '',
		borderClass = 'border-surface-300-700 border-1',
		roundedClass = 'rounded-lg',
		sceneReady
	}: Props = $props();

	let outerEl: HTMLDivElement;

	onMount(() => {
		const ctx = createBaseSceneAndRenderer(outerEl);
		ctx.renderer.domElement.classList.add(...roundedClass.split(' '));
		sceneReady(ctx);
		return ctx.dispose;
	});
</script>

<div class={[classes, borderClass, roundedClass]} bind:this={outerEl}></div>
