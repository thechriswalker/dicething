<script lang="ts">
	import { getLightDarkContext } from '$lib/components/light_switch/light_dark_context';
	import { getPreferences } from '$lib/interfaces/preferences.svelte';
	import {
		attachEngineViewport,
		detachEngineViewport,
		onEngineSelection,
		resizeEngineViewport,
		sendEnginePointer,
		setEngineBackground,
		setEngineWireframe
	} from '$lib/utils/die_engine_client';
	import { engineTraceSpan } from '$lib/utils/engine_trace';
	import { onMount, type Snippet } from 'svelte';

	export type EngineSceneHandle = {
		setWireframe: (on: boolean) => void;
		setStatsVisible: (on: boolean) => void;
		dispose: () => void;
	};

	interface Props {
		class?: string;
		borderClass?: string;
		roundedClass?: string;
		sceneReady: (ctx: EngineSceneHandle) => void;
		onSelection?: (state: { dieId: string; hoverFace: number; clickFace?: number; shiftKey?: boolean }) => void;
		children?: Snippet;
	}

	let {
		class: classes = '',
		borderClass = 'border-surface-300-700 border-1',
		roundedClass = 'rounded-lg',
		sceneReady,
		onSelection,
		children
	}: Props = $props();

	let outerEl: HTMLDivElement;
	let canvasEl: HTMLCanvasElement;
	const ldCtx = getLightDarkContext();
	const prefs = getPreferences();

	let bgColor = $derived.by(() => {
		let c = ldCtx.bgColor;
		if (ldCtx.isDark) {
			c = c.lighten(0.3);
		} else {
			c = c.darken(0.05);
		}
		return c.toNumber();
	});

	let wireframeOn = false;
	let handle: EngineSceneHandle | undefined;

	onMount(() => {
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, outerEl.clientWidth);
		const h = Math.max(1, outerEl.clientHeight);
		let disposed = false;

		const viewportSpan = engineTraceSpan('initViewport');
		void attachEngineViewport(canvasEl, w, h, dpr, bgColor)
			.then(() => {
				if (disposed) {
					return;
				}
				viewportSpan.end({ w, h, dpr });
				// Observe the outer flex box, not the canvas. Canvas bitmap width/height
				// are intrinsic sizing (and can't be cleared after transferControlToOffscreen),
				// so without min-h-0 on this element a grow flex child refuses to shrink and
				// this observer never sees a smaller size.
				const resizeObserver = new ResizeObserver((entries) => {
					const entry = entries[0];
					const rw = entry?.contentRect.width ?? outerEl.clientWidth;
					const rh = entry?.contentRect.height ?? outerEl.clientHeight;
					if (rw >= 1 && rh >= 1) {
						void resizeEngineViewport(rw, rh, window.devicePixelRatio || 1);
					}
				});
				resizeObserver.observe(outerEl);

				const unsubSelection = onEngineSelection((state) => {
					onSelection?.({
						dieId: state.dieId,
						hoverFace: state.hoverFace,
						clickFace: state.clickFace,
						shiftKey: state.shiftKey
					});
				});

				handle = {
					setWireframe(on: boolean) {
						wireframeOn = on;
						setEngineWireframe(on);
					},
					setStatsVisible(_on: boolean) {
						// stats overlay stays on main thread in dev if needed later
					},
					dispose() {
						unsubSelection();
						resizeObserver.disconnect();
						void detachEngineViewport();
					}
				};
				sceneReady(handle);
			})
			.catch((e) => {
				viewportSpan.end({ error: e instanceof Error ? e.message : String(e) });
				console.error('initViewport failed', e);
			});

		return () => {
			disposed = true;
			handle?.dispose();
		};
	});

	$effect(() => {
		setEngineBackground(bgColor);
	});

	function pointerStyle(ev: PointerEvent) {
		const rect = canvasEl.getBoundingClientRect();
		return {
			type: ev.type as 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerleave',
			offsetX: ev.clientX - rect.left,
			offsetY: ev.clientY - rect.top,
			clientWidth: rect.width,
			clientHeight: rect.height,
			buttons: ev.buttons,
			button: ev.button,
			pointerId: ev.pointerId,
			shiftKey: ev.shiftKey,
			altKey: ev.altKey,
			ctrlKey: ev.ctrlKey,
			metaKey: ev.metaKey
		};
	}
</script>

<!-- min-h-0: flex grow children default to min-height:auto (content = canvas bitmap),
     which blocks shrink-on-window-resize. absolute canvas: keep intrinsic size out of flow. -->
<div
	class={[classes, borderClass, roundedClass, 'relative min-h-0 min-w-0 overflow-hidden']}
	bind:this={outerEl}
>
	<canvas
		bind:this={canvasEl}
		class={['absolute inset-0 block size-full', roundedClass]}
		style:background={`#${bgColor.toString(16).padStart(6, '0')}`}
		onpointerdown={(e) => sendEnginePointer(pointerStyle(e))}
		onpointermove={(e) => sendEnginePointer(pointerStyle(e))}
		onpointerup={(e) => sendEnginePointer(pointerStyle(e))}
		onpointerleave={(e) => sendEnginePointer({ ...pointerStyle(e), type: 'pointerleave' })}
		onwheel={(e) => {
			e.preventDefault();
			const rect = canvasEl.getBoundingClientRect();
			sendEnginePointer({
				type: 'wheel',
				offsetX: e.clientX - rect.left,
				offsetY: e.clientY - rect.top,
				clientWidth: rect.width,
				clientHeight: rect.height,
				buttons: 0,
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				deltaY: e.deltaY
			});
		}}
	></canvas>
	{@render children?.()}
</div>
