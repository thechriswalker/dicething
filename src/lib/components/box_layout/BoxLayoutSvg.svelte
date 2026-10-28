<script lang="ts">
	import { BOX_LAYOUT_COLOURS, type LayoutFigure } from '$lib/box/layout_figure';

	let { figure, class: className = '' }: { figure: LayoutFigure; class?: string } = $props();

	function pts(poly: Array<{ x: number; y: number }>): string {
		// SVG y is down; the box frame's y is up.
		return poly.map((p) => `${p.x},${-p.y}`).join(' ');
	}

	let bounds = $derived.by(() => {
		let ex = 1;
		let ey = 1;
		const consider = (p: { x: number; y: number }) => {
			ex = Math.max(ex, Math.abs(p.x));
			ey = Math.max(ey, Math.abs(p.y));
		};
		for (const p of figure.body) consider(p);
		for (const p of figure.inner) consider(p);
		for (const d of figure.dice) {
			for (const p of d.points) consider(p);
		}
		const pad = Math.max(ex, ey) * 0.08 + 2;
		return { x: ex + pad, y: ey + pad };
	});
	let u = $derived(Math.max(bounds.x, bounds.y) / 100);
</script>

<svg
	class={className}
	viewBox="{-bounds.x} {-bounds.y} {2 * bounds.x} {2 * bounds.y}"
	preserveAspectRatio="xMidYMid meet"
	aria-hidden="true"
>
	<polygon
		points={pts(figure.body)}
		fill="currentColor"
		fill-opacity="0.18"
		stroke="currentColor"
		stroke-opacity="0.75"
		stroke-width={u}
		stroke-linejoin="round"
	/>
	<polygon
		points={pts(figure.inner)}
		fill="none"
		stroke="#f472b6"
		stroke-width={u}
		stroke-dasharray="{u * 2} {u * 1.5}"
	/>
	{#each figure.corners as c (c.x + ':' + c.y)}
		<circle
			cx={c.x}
			cy={-c.y}
			r={figure.magRadius}
			fill="#888"
			fill-opacity="0.5"
			stroke="#555"
			stroke-width={u * 0.6}
		/>
	{/each}
	{#each figure.dice as die (die.index)}
		<polygon
			points={pts(die.points)}
			fill={BOX_LAYOUT_COLOURS[die.index % BOX_LAYOUT_COLOURS.length]}
			fill-opacity="0.4"
			stroke={BOX_LAYOUT_COLOURS[die.index % BOX_LAYOUT_COLOURS.length]}
			stroke-width={u}
			stroke-linejoin="round"
		/>
		<text
			x={die.points.reduce((s, p) => s + p.x, 0) / die.points.length}
			y={-die.points.reduce((s, p) => s + p.y, 0) / die.points.length}
			font-size={u * 5}
			fill="currentColor"
			text-anchor="middle"
			dominant-baseline="central">{die.index + 1}</text
		>
	{/each}
</svg>
