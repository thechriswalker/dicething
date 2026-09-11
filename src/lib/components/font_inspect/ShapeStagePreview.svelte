<script lang="ts">
	import { shapesToSVG } from '$lib/utils/shapes';
	import { Box2, Vector2, type Shape } from 'three';

	let el: HTMLDivElement;
	let { shapes, class: classes = '' }: { shapes: Array<Shape>; class?: string } = $props();

	$effect(() => {
		const list = shapes ?? [];
		const svg = shapesToSVG(list);

		const box = new Box2();
		for (const s of list) {
			try {
				for (const p of s.getPoints()) {
					box.expandByPoint(p);
				}
				for (const h of s.holes) {
					for (const p of h.getPoints()) {
						box.expandByPoint(p);
					}
				}
			} catch {
				/* getPoints can throw on broken curves; stats surface that elsewhere */
			}
		}
		if (box.isEmpty()) {
			svg.setAttribute('viewBox', '-6 -6 12 12');
		} else {
			const size = box.getSize(new Vector2());
			const pad = Math.max(size.x, size.y) * 0.1 || 1;
			svg.setAttribute(
				'viewBox',
				`${box.min.x - pad} ${box.min.y - pad} ${size.x + 2 * pad} ${size.y + 2 * pad}`
			);
		}
		svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
		svg.classList.add('fill-current', '-scale-y-100', 'h-full', 'w-full');
		el.replaceChildren(svg);
	});
</script>

<div
	bind:this={el}
	class={'aspect-1 rounded bg-cyan-900 p-1 text-cyan-50 ' +
		(shapes.length === 0 ? 'opacity-40 ' : '') +
		classes}
></div>
