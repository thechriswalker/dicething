<script lang="ts">
	import { Vector2 } from 'three';
	import { boxOutline, deriveAutoLayout, isLayoutValid, LAYOUT_MIN_HALF, rotateHull } from '$lib/box/box_builder';
	import {
		defaultBoxParams,
		layoutParamsFrom,
		layoutShapeFrom,
		BOX_PARAM_SLIDER_BOUNDS,
		type BoxParams
	} from '$lib/box/types';
	import type { EditorItem, LayoutResult } from './types';
	import Slider from '$lib/components/slider/Slider.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		XIcon,
		RotateCcwIcon,
		WandSparklesIcon,
		ZoomInIcon,
		ZoomOutIcon,
		MaximizeIcon
	} from '@lucide/svelte';

	type Props = {
		open: boolean;
		initialItems: Array<EditorItem>;
		initialBox: { halfX: number; halfY: number };
		params: BoxParams;
		dieLabel: (kind: string) => string;
		onApply: (result: LayoutResult) => void;
		onClose: () => void;
	};

	let { open, initialItems, initialBox, params, dieLabel, onApply, onClose }: Props = $props();

	// --- editable working state (seeded from props each time the modal opens) ---
	let items = $state<Array<EditorItem>>([]);
	// the box is centred on the origin for the build, but during editing it can be
	// off-centre (cx,cy) so a dragged wall follows the cursor 1:1 without the dice
	// jumping; apply() recentres it.
	let box = $state({ cx: 0, cy: 0, halfX: 0, halfY: 0 });
	let lp = $state(layoutParamsFrom(defaultBoxParams()));
	// box-shape params that affect the 2D outline (so the preview reflects them).
	let shape = $state(layoutShapeFrom(defaultBoxParams()));
	let selected = $state<string | null>(null);
	// the view is a fixed "fit" extent (set when the modal opens / on Fit) scaled
	// by a manual zoom factor - it never auto-zooms while you drag the box.
	let baseX = $state(50);
	let baseY = $state(50);
	let zoom = $state(1);
	let initialSnapshot = '';
	// die x/y/rotation are mutated in place; bump this after each change so hull
	// outlines and overlap highlighting stay in sync during drags.
	let layoutVersion = $state(0);
	function touchLayout() {
		layoutVersion++;
	}

	function seed() {
		items = initialItems.map((it) => ({
			...it,
			hull0: it.hull0.map((p) => p.clone()),
			size: it.size.clone()
		}));
		box = { cx: 0, cy: 0, halfX: initialBox.halfX, halfY: initialBox.halfY };
		lp = layoutParamsFrom(params);
		shape = layoutShapeFrom(params);
		selected = null;
		// a previously-saved box may be too small for its magnets/chamfer; open in a
		// valid state so the preview is correct from the start.
		ensureValid();
		fitView();
		initialSnapshot = snapshot();
		touchLayout();
	}

	function snapshot(): string {
		return JSON.stringify({
			items: items.map((it) => ({
				dieId: it.dieId,
				x: it.x,
				y: it.y,
				rotation: it.rotation,
				include: it.include
			})),
			box,
			lp,
			shape
		});
	}

	// re-seed whenever the modal transitions to open (or its inputs change).
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			seed();
		}
		wasOpen = open;
	});

	const PALETTE = ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#34d399', '#fb923c', '#60a5fa'];

	let effParams = $derived<BoxParams>({
		...params,
		rows: lp.rows,
		gap: lp.gap,
		chamfer: shape.chamfer,
		wall: shape.wall,
		magnets: {
			...params.magnets,
			enabled: shape.magnetsEnabled,
			count: shape.magnetCount,
			diameter: shape.magnetDiameter,
			tolerance: shape.magnetTolerance
		}
	});

	function includedItems(): Array<EditorItem> {
		return items.filter((it) => it.include);
	}
	// world-space hull of one die in its current position + rotation.
	function placedOf(it: EditorItem): Array<Vector2> {
		return rotateHull(it.hull0, it.rotation).map((p) => new Vector2(p.x + it.x, p.y + it.y));
	}
	// hull in the box-centred frame (box outline / containment maths are centred).
	function centeredHullOf(it: EditorItem): Array<Vector2> {
		return placedOf(it).map((p) => new Vector2(p.x - box.cx, p.y - box.cy));
	}
	function centeredPlaced(): Array<Vector2> {
		const out: Array<Vector2> = [];
		for (const it of includedItems()) {
			out.push(...centeredHullOf(it));
		}
		return out;
	}

	let outline = $derived.by(() => {
		layoutVersion;
		return boxOutline(effParams, new Vector2(box.halfX, box.halfY), centeredPlaced());
	});
	let placedHulls = $derived.by(() => {
		layoutVersion;
		return items.map((it) => placedOf(it));
	});

	// frame the view to the current content (box + included dice + padding) and
	// reset the zoom. Called when the modal opens and from the Fit button.
	function fitView() {
		let ex = Math.abs(box.cx) + box.halfX;
		let ey = Math.abs(box.cy) + box.halfY;
		for (const it of includedItems()) {
			for (const p of placedOf(it)) {
				ex = Math.max(ex, Math.abs(p.x));
				ey = Math.max(ey, Math.abs(p.y));
			}
		}
		const pad = Math.max(ex, ey) * 0.12 + 6;
		baseX = ex + pad;
		baseY = ey + pad;
		zoom = 1;
	}

	// the visible half-extents: the fit extent divided by the manual zoom factor.
	let viewX = $derived(baseX / zoom);
	let viewY = $derived(baseY / zoom);
	let u = $derived(Math.max(viewX, viewY) / 100); // 1 "unit" in world mm for handles/strokes
	let viewBox = $derived(`${-viewX} ${-viewY} ${2 * viewX} ${2 * viewY}`);

	const ZOOM_STEP = 1.2;
	const ZOOM_MIN = 0.2;
	const ZOOM_MAX = 8;
	function zoomBy(factor: number) {
		zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
	}
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
	}

	function ptsStr(poly: Array<Vector2>): string {
		// SVG y is down; our world y is up, so negate y when drawing.
		return poly.map((p) => `${p.x},${-p.y}`).join(' ');
	}
	// box outline is computed in the box-centred frame; shift it to where the box
	// currently sits (cx,cy) for drawing.
	function ptsStrC(poly: Array<Vector2>): string {
		return poly.map((p) => `${p.x + box.cx},${-(p.y + box.cy)}`).join(' ');
	}

	// convex-polygon overlap (separating-axis test). The die hulls are convex, so a
	// gap along any edge normal of either means they don't overlap. A tiny epsilon
	// keeps merely-touching dice from reading as overlapping.
	function polysOverlap(a: Array<Vector2>, b: Array<Vector2>): boolean {
		const EPS = 1e-3;
		for (const poly of [a, b]) {
			for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
				const nx = -(poly[i].y - poly[j].y);
				const ny = poly[i].x - poly[j].x;
				let minA = Infinity;
				let maxA = -Infinity;
				let minB = Infinity;
				let maxB = -Infinity;
				for (const p of a) {
					const d = p.x * nx + p.y * ny;
					minA = Math.min(minA, d);
					maxA = Math.max(maxA, d);
				}
				for (const p of b) {
					const d = p.x * nx + p.y * ny;
					minB = Math.min(minB, d);
					maxB = Math.max(maxB, d);
				}
				if (maxA < minB + EPS || maxB < minA + EPS) {
					return false;
				}
			}
		}
		return true;
	}

	// dice whose hulls intersect another die's: allowed (you may be reordering) but
	// flagged red so the overlap is obvious.
	let overlapIds = $derived.by(() => {
		layoutVersion;
		const s = new Set<string>();
		const inc = includedItems();
		const hulls = inc.map((it) => placedOf(it));
		for (let i = 0; i < inc.length; i++) {
			for (let j = i + 1; j < inc.length; j++) {
				if (polysOverlap(hulls[i], hulls[j])) {
					s.add(inc[i].dieId);
					s.add(inc[j].dieId);
				}
			}
		}
		return s;
	});

	// validity of a trial layout:
	//  - every die hull stays inside the interior recess octagon (the box can't
	//    cut across a die), and
	//  - every magnet bore sits in a solid corner: inside the body octagon and
	//    clear of the recess (so shrinking can't let the recess swallow a magnet).
	// The outline depends on the dice + params, so recompute it for the trial.
	function valid(): boolean {
		if (includedItems().length === 0) {
			return true;
		}
		return isLayoutValid(effParams, new Vector2(box.halfX, box.halfY), centeredPlaced());
	}

	// grow the box uniformly until the layout is valid (recovery for a too-small
	// saved box, or after enlarging the chamfer / magnets). Keeps dice positions.
	function ensureValid() {
		let guard = 0;
		while (!valid() && guard++ < 400) {
			box.halfX += 0.5;
			box.halfY += 0.5;
		}
	}

	function tryDie(it: EditorItem, nx: number, ny: number): boolean {
		const ox = it.x;
		const oy = it.y;
		it.x = nx;
		it.y = ny;
		if (valid()) {
			touchLayout();
			return true;
		}
		it.x = ox;
		it.y = oy;
		return false;
	}

	const MIN_HALF = LAYOUT_MIN_HALF;
	// Move one wall (sign sx = +1 right / -1 left) to world x `target`, keeping the
	// opposite wall fixed. The box stays a centred rectangle by also shifting its
	// centre (cx); the dice don't move, so the wall tracks the cursor 1:1. Reverts
	// if the result is invalid (a wall can't cut across a die or a magnet).
	function tryEdgeX(sx: number, target: number): boolean {
		if (!sx) {
			return false;
		}
		const opp = box.cx - sx * box.halfX; // the wall that must stay put
		const half = ((target - opp) * sx) / 2; // signed width on sx's side, halved
		if (half < MIN_HALF) {
			return false;
		}
		const oc = box.cx;
		const oh = box.halfX;
		box.cx = (target + opp) / 2;
		box.halfX = half;
		if (valid()) {
			return true;
		}
		box.cx = oc;
		box.halfX = oh;
		return false;
	}
	function tryEdgeY(sy: number, target: number): boolean {
		if (!sy) {
			return false;
		}
		const opp = box.cy - sy * box.halfY;
		const half = ((target - opp) * sy) / 2;
		if (half < MIN_HALF) {
			return false;
		}
		const oc = box.cy;
		const oh = box.halfY;
		box.cy = (target + opp) / 2;
		box.halfY = half;
		if (valid()) {
			return true;
		}
		box.cy = oc;
		box.halfY = oh;
		return false;
	}

	function tryRotate(it: EditorItem, rot: number): boolean {
		const o = it.rotation;
		it.rotation = rot;
		if (valid()) {
			touchLayout();
			return true;
		}
		it.rotation = o;
		return false;
	}

	// --- pointer interaction ----------------------------------------------------
	let svgEl = $state<SVGSVGElement>();
	type Drag =
		| { kind: 'die'; dieId: string; grab: Vector2; orig: Vector2 }
		| { kind: 'rotate'; dieId: string; startAngle: number; startRot: number }
		| { kind: 'resize'; sx: number; sy: number };
	let drag: Drag | null = null;
	// active alignment guides while dragging a die (snapped to another die's centre).
	let guides = $state<{ x: number | null; y: number | null }>({ x: null, y: null });

	function clientToWorld(e: PointerEvent): Vector2 {
		const ctm = svgEl?.getScreenCTM();
		if (!svgEl || !ctm) {
			return new Vector2(0, 0);
		}
		const pt = svgEl.createSVGPoint();
		pt.x = e.clientX;
		pt.y = e.clientY;
		const v = pt.matrixTransform(ctm.inverse());
		return new Vector2(v.x, -v.y);
	}

	function startDie(e: PointerEvent, dieId: string) {
		e.stopPropagation();
		selected = dieId;
		const it = items.find((i) => i.dieId === dieId);
		if (!it) {
			return;
		}
		drag = { kind: 'die', dieId, grab: clientToWorld(e), orig: new Vector2(it.x, it.y) };
		svgEl?.setPointerCapture(e.pointerId);
	}

	function startRotate(e: PointerEvent, dieId: string) {
		e.stopPropagation();
		const it = items.find((i) => i.dieId === dieId);
		if (!it) {
			return;
		}
		const w = clientToWorld(e);
		drag = {
			kind: 'rotate',
			dieId,
			startAngle: Math.atan2(w.y - it.y, w.x - it.x),
			startRot: it.rotation
		};
		svgEl?.setPointerCapture(e.pointerId);
	}

	function startResize(e: PointerEvent, sx: number, sy: number) {
		e.stopPropagation();
		drag = { kind: 'resize', sx, sy };
		svgEl?.setPointerCapture(e.pointerId);
	}

	function onMove(e: PointerEvent) {
		const d = drag;
		if (!d) {
			return;
		}
		const w = clientToWorld(e);
		if (d.kind === 'die') {
			const it = items.find((i) => i.dieId === d.dieId);
			if (!it) {
				return;
			}
			let nx = d.orig.x + (w.x - d.grab.x);
			let ny = d.orig.y + (w.y - d.grab.y);
			// snap the centre to another die's centre line (row/column alignment).
			const thr = 4 * u;
			let gx: number | null = null;
			let gy: number | null = null;
			let bestX = thr;
			let bestY = thr;
			for (const o of includedItems()) {
				if (o.dieId === it.dieId) {
					continue;
				}
				const dx = Math.abs(nx - o.x);
				if (dx < bestX) {
					bestX = dx;
					gx = o.x;
				}
				const dy = Math.abs(ny - o.y);
				if (dy < bestY) {
					bestY = dy;
					gy = o.y;
				}
			}
			if (gx !== null) {
				nx = gx;
			}
			if (gy !== null) {
				ny = gy;
			}
			if (!tryDie(it, nx, ny)) {
				// fall back to whichever single axis still fits (anchor the other
				// axis at drag-start so a partial move isn't undone by the 2nd try).
				if (!tryDie(it, nx, d.orig.y)) {
					tryDie(it, d.orig.x, ny);
				}
			}
			// only show a guide for an axis the die actually landed on.
			guides = {
				x: gx !== null && Math.abs(it.x - gx) < 1e-6 ? gx : null,
				y: gy !== null && Math.abs(it.y - gy) < 1e-6 ? gy : null
			};
		} else if (d.kind === 'rotate') {
			const it = items.find((i) => i.dieId === d.dieId);
			if (!it) {
				return;
			}
			const ang = Math.atan2(w.y - it.y, w.x - it.x);
			tryRotate(it, d.startRot + (ang - d.startAngle));
		} else if (d.kind === 'resize') {
			// move just the grabbed wall(s) toward the cursor; each axis is clamped
			// independently so a blocked axis doesn't freeze the other.
			tryEdgeX(d.sx, w.x);
			tryEdgeY(d.sy, w.y);
		}
	}

	function onUp(e: PointerEvent) {
		if (drag && svgEl?.hasPointerCapture(e.pointerId)) {
			svgEl.releasePointerCapture(e.pointerId);
		}
		drag = null;
		guides = { x: null, y: null };
	}

	function autoArrange() {
		const auto = deriveAutoLayout(
			includedItems().map((it) => ({ dieId: it.dieId, hull: rotateHull(it.hull0, it.rotation) })),
			effParams
		);
		for (const it of items) {
			const pos = auto.positions.get(it.dieId);
			if (pos) {
				it.x = pos.x;
				it.y = pos.y;
			}
		}
		box = { cx: 0, cy: 0, halfX: auto.outerHalf.x, halfY: auto.outerHalf.y };
		touchLayout();
	}

	// Toggle a die in/out of the layout. Newly included dice land at the origin;
	// the box then grows if needed to keep everything valid.
	function toggleInclude(it: EditorItem) {
		it.include = !it.include;
		if (it.include) {
			it.x = 0;
			it.y = 0;
			ensureValid();
		} else if (selected === it.dieId) {
			selected = null;
		}
		touchLayout();
	}

	function reset() {
		const snap = JSON.parse(initialSnapshot) as {
			items: Array<{ dieId: string; x: number; y: number; rotation: number; include: boolean }>;
			box: typeof box;
			lp: typeof lp;
			shape: typeof shape;
		};
		const byId = new Map(snap.items.map((s) => [s.dieId, s]));
		for (const it of items) {
			const s = byId.get(it.dieId);
			if (s) {
				it.x = s.x;
				it.y = s.y;
				it.rotation = s.rotation;
				it.include = s.include;
			}
		}
		box = { ...snap.box };
		lp = { ...snap.lp };
		shape = { ...snap.shape };
		selected = null;
		touchLayout();
	}

	function apply() {
		// recentre the (possibly off-centre) editing box onto the origin: shift all
		// dice by -centre so the stored placements are relative to a centred box.
		onApply({
			placements: items.map((it) => ({
				dieId: it.dieId,
				x: it.x - box.cx,
				y: it.y - box.cy,
				rotation: it.rotation,
				include: it.include
			})),
			box: { halfX: box.halfX, halfY: box.halfY },
			layoutParams: { ...lp },
			shape: { ...shape }
		});
	}

	// changing a shape param can invalidate the current box (deeper chamfer,
	// bigger magnets); grow it back to a valid size so the preview stays correct.
	function onShapeChange() {
		ensureValid();
	}

	function dieColour(i: number): string {
		return PALETTE[i % PALETTE.length];
	}
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex flex-col">
		<button
			class="bg-surface-50-950/60 absolute inset-0"
			aria-label={m.boxes_layout_cancel()}
			onclick={onClose}
		></button>
		<div
			class="card bg-surface-100-900 relative m-auto flex h-[90vh] w-[92vw] max-w-6xl flex-col gap-3 p-4 shadow-xl"
		>
			<header class="flex items-center justify-between">
				<h2 class="text-lg font-bold">{m.boxes_layout_title()}</h2>
				<button
					class="btn-icon hover:preset-tonal"
					aria-label={m.boxes_layout_cancel()}
					onclick={onClose}
				>
					<XIcon class="size-4" />
				</button>
			</header>

			<div class="flex flex-wrap items-end gap-4">
				<div class="flex w-40 flex-col">
					<span class="flex justify-between text-xs"
						><span>{m.boxes_rows()}</span><span>{lp.rows}</span></span
					>
					<Slider
						class="py-1"
						value={lp.rows}
						min={BOX_PARAM_SLIDER_BOUNDS.rows.min}
						max={Math.max(BOX_PARAM_SLIDER_BOUNDS.rows.min, items.length)}
						step={BOX_PARAM_SLIDER_BOUNDS.rows.step}
						onChange={(v) => (lp.rows = v)}
					/>
				</div>
				<div class="flex w-40 flex-col">
					<span class="flex justify-between text-xs"
						><span>{m.boxes_gap()}</span><span>{lp.gap}</span></span
					>
					<Slider
						class="py-1"
						value={lp.gap}
						{...BOX_PARAM_SLIDER_BOUNDS.gap}
						onChange={(v) => (lp.gap = v)}
					/>
				</div>
				<button class="btn btn-sm preset-tonal-primary" onclick={autoArrange}>
					<WandSparklesIcon class="size-4" />
					<span>{m.boxes_layout_auto_arrange()}</span>
				</button>
				<button class="btn btn-sm preset-tonal" onclick={reset}>
					<RotateCcwIcon class="size-4" />
					<span>{m.boxes_layout_reset()}</span>
				</button>
			</div>

			<div class="border-surface-300-700 flex flex-wrap items-end gap-4 border-t pt-2">
				<div class="flex w-40 flex-col">
					<span class="flex justify-between text-xs"
						><span>{m.boxes_chamfer()}</span><span>{shape.chamfer}</span></span
					>
					<Slider
						class="py-1"
						value={shape.chamfer}
						{...BOX_PARAM_SLIDER_BOUNDS.chamfer}
						onChange={(v) => {
							shape.chamfer = v;
							onShapeChange();
						}}
					/>
				</div>
				<div class="flex w-40 flex-col">
					<span class="flex justify-between text-xs"
						><span>{m.boxes_wall()}</span><span>{shape.wall}</span></span
					>
					<Slider
						class="py-1"
						value={shape.wall}
						{...BOX_PARAM_SLIDER_BOUNDS.wall}
						onChange={(v) => {
							shape.wall = v;
							onShapeChange();
						}}
					/>
				</div>
				<label class="flex items-center gap-2 text-xs">
					<input
						type="checkbox"
						class="checkbox"
						checked={shape.magnetsEnabled}
						onchange={(e) => {
							shape.magnetsEnabled = e.currentTarget.checked;
							onShapeChange();
						}}
					/>
					<span>{m.boxes_magnets_enabled()}</span>
				</label>
				{#if shape.magnetsEnabled}
					<div class="flex w-32 flex-col">
						<span class="flex justify-between text-xs"
							><span>{m.boxes_magnet_count()}</span><span>{shape.magnetCount}</span></span
						>
						<Slider
							class="py-1"
							value={shape.magnetCount}
							{...BOX_PARAM_SLIDER_BOUNDS.magnets.count}
							onChange={(v) => {
								shape.magnetCount = v;
								onShapeChange();
							}}
						/>
					</div>
					<div class="flex w-32 flex-col">
						<span class="flex justify-between text-xs"
							><span>{m.boxes_magnet_diameter()}</span><span>{shape.magnetDiameter}</span></span
						>
						<Slider
							class="py-1"
							value={shape.magnetDiameter}
							{...BOX_PARAM_SLIDER_BOUNDS.magnets.diameter}
							onChange={(v) => {
								shape.magnetDiameter = v;
								onShapeChange();
							}}
						/>
					</div>
					<div class="flex w-32 flex-col">
						<span class="flex justify-between text-xs"
							><span>{m.boxes_magnet_tolerance()}</span><span>{shape.magnetTolerance}</span></span
						>
						<Slider
							class="py-1"
							value={shape.magnetTolerance}
							{...BOX_PARAM_SLIDER_BOUNDS.magnets.tolerance}
							onChange={(v) => {
								shape.magnetTolerance = v;
								onShapeChange();
							}}
						/>
					</div>
				{/if}
			</div>

			<p class="text-surface-600-400 text-xs">{m.boxes_layout_hint()}</p>

			{#if items.length > 0}
				<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
					{#each items as it, i (it.dieId)}
						<label class="flex items-center gap-1" class:opacity-40={!it.include}>
							<input
								type="checkbox"
								class="checkbox"
								checked={it.include}
								onchange={() => toggleInclude(it)}
							/>
							<span class="inline-block size-3 rounded-sm" style={`background:${dieColour(i)}`}
							></span>
							<span>{i + 1}. {dieLabel(it.kind)}</span>
						</label>
					{/each}
				</div>
			{/if}

			<div class="bg-surface-200-800 relative min-h-0 flex-1 overflow-hidden rounded-md">
				{#if items.length === 0}
					<p class="text-surface-600-400 absolute inset-0 flex items-center justify-center text-sm">
						{m.boxes_layout_empty()}
					</p>
				{:else}
					<div class="absolute top-2 right-2 z-10 flex flex-col gap-1">
						<button
							class="btn-icon btn-icon-sm preset-filled-surface-100-900"
							aria-label={m.boxes_layout_zoom_in()}
							onclick={() => zoomBy(ZOOM_STEP)}><ZoomInIcon class="size-4" /></button
						>
						<button
							class="btn-icon btn-icon-sm preset-filled-surface-100-900"
							aria-label={m.boxes_layout_zoom_out()}
							onclick={() => zoomBy(1 / ZOOM_STEP)}><ZoomOutIcon class="size-4" /></button
						>
						<button
							class="btn-icon btn-icon-sm preset-filled-surface-100-900"
							aria-label={m.boxes_layout_zoom_fit()}
							onclick={fitView}><MaximizeIcon class="size-4" /></button
						>
					</div>
					<svg
						bind:this={svgEl}
						class="h-full w-full touch-none select-none"
						{viewBox}
						preserveAspectRatio="xMidYMid meet"
						onpointermove={onMove}
						onpointerup={onUp}
						onpointercancel={onUp}
						onpointerdown={() => (selected = null)}
						onwheel={onWheel}
						role="application"
						aria-label={m.boxes_layout_title()}
					>
						<!-- body octagon -->
						<polygon
							points={ptsStrC(outline.body)}
							fill="var(--color-surface-300-700, #999)"
							fill-opacity="0.25"
							stroke="currentColor"
							stroke-opacity="0.7"
							stroke-width={u}
						/>
						<!-- interior recess octagon -->
						<polygon
							points={ptsStrC(outline.inner)}
							fill="none"
							stroke="#f472b6"
							stroke-width={u}
							stroke-dasharray={`${u * 2} ${u * 1.5}`}
						/>
						<!-- magnets -->
						{#each outline.corners as c (c.x + ':' + c.y)}
							<circle
								cx={c.x + box.cx}
								cy={-(c.y + box.cy)}
								r={outline.magRadius}
								fill="#888"
								fill-opacity="0.5"
								stroke="#555"
								stroke-width={u * 0.6}
							/>
						{/each}

						<!-- alignment guides (snap to another die's centre line) -->
						{#if guides.x !== null}
							<line
								x1={guides.x}
								y1={-viewY}
								x2={guides.x}
								y2={viewY}
								stroke="#22d3ee"
								stroke-width={u}
								stroke-dasharray={`${u * 2} ${u * 2}`}
								style="pointer-events:none"
							/>
						{/if}
						{#if guides.y !== null}
							<line
								x1={-viewX}
								y1={-guides.y}
								x2={viewX}
								y2={-guides.y}
								stroke="#22d3ee"
								stroke-width={u}
								stroke-dasharray={`${u * 2} ${u * 2}`}
								style="pointer-events:none"
							/>
						{/if}

						<!-- dice (only the included ones are placed in the box) -->
						{#each items as it, i (it.dieId)}
							{#if it.include}
								{@const poly = placedHulls[i]}
								{@const sel = selected === it.dieId}
								{@const overlap = overlapIds.has(it.dieId)}
								<polygon
									points={ptsStr(poly)}
									fill={overlap ? '#ef4444' : dieColour(i)}
									fill-opacity={overlap ? 0.5 : sel ? 0.55 : 0.35}
									stroke={overlap ? '#ef4444' : dieColour(i)}
									stroke-width={sel ? u * 1.6 : u}
									style="cursor:grab"
									onpointerdown={(e) => startDie(e, it.dieId)}
								/>
								<text
									x={it.x}
									y={-it.y}
									font-size={u * 5}
									fill="currentColor"
									text-anchor="middle"
									dominant-baseline="central"
									style="pointer-events:none">{i + 1}</text
								>
								{#if sel}
									{@const top = Math.max(...poly.map((p) => p.y)) + u * 5}
									<line
										x1={it.x}
										y1={-it.y}
										x2={it.x}
										y2={-top}
										stroke={dieColour(i)}
										stroke-width={u}
									/>
									<circle
										cx={it.x}
										cy={-top}
										r={u * 2.5}
										fill="#fff"
										stroke={dieColour(i)}
										stroke-width={u}
										style="cursor:grab"
										onpointerdown={(e) => startRotate(e, it.dieId)}
										role="button"
										aria-label={m.boxes_layout_rotate()}
									/>
								{/if}
							{/if}
						{/each}

						<!-- box resize handles (corners + edge midpoints) -->
						{#each [[1, 1], [-1, 1], [-1, -1], [1, -1]] as [sx, sy] (sx + ':' + sy)}
							<rect
								x={box.cx + sx * box.halfX - u * 2}
								y={-(box.cy + sy * box.halfY) - u * 2}
								width={u * 4}
								height={u * 4}
								fill="#fff"
								stroke="currentColor"
								stroke-width={u}
								style="cursor:nwse-resize"
								onpointerdown={(e) => startResize(e, sx, sy)}
								role="button"
								aria-label={m.boxes_layout_title()}
							/>
						{/each}
						{#each [[1, 0], [-1, 0]] as [sx] (sx + ':x')}
							<rect
								x={box.cx + sx * box.halfX - u * 1.6}
								y={box.cy * -1 - u * 1.6}
								width={u * 3.2}
								height={u * 3.2}
								fill="#fff"
								stroke="currentColor"
								stroke-width={u}
								style="cursor:ew-resize"
								onpointerdown={(e) => startResize(e, sx, 0)}
								role="button"
								aria-label={m.boxes_layout_title()}
							/>
						{/each}
						{#each [[0, 1], [0, -1]] as [, sy] (sy + ':y')}
							<rect
								x={box.cx - u * 1.6}
								y={-(box.cy + sy * box.halfY) - u * 1.6}
								width={u * 3.2}
								height={u * 3.2}
								fill="#fff"
								stroke="currentColor"
								stroke-width={u}
								style="cursor:ns-resize"
								onpointerdown={(e) => startResize(e, 0, sy)}
								role="button"
								aria-label={m.boxes_layout_title()}
							/>
						{/each}

						<!-- hinge / opening side labels -->
						<text
							x={box.cx}
							y={-(box.cy + box.halfY) - u * 1.5}
							font-size={u * 4}
							fill="currentColor"
							fill-opacity="0.6"
							text-anchor="middle">{m.boxes_layout_hinge_side()}</text
						>
						<text
							x={box.cx}
							y={-(box.cy - box.halfY) + u * 5}
							font-size={u * 4}
							fill="currentColor"
							fill-opacity="0.6"
							text-anchor="middle">{m.boxes_layout_opening_side()}</text
						>
					</svg>
				{/if}
			</div>

			<footer class="flex items-center justify-between gap-2">
				<span class="text-surface-600-400 text-xs">
					{m.boxes_outer_size({ x: (box.halfX * 2).toFixed(1), y: (box.halfY * 2).toFixed(1) })}
				</span>
				<div class="flex gap-2">
					<button class="btn preset-tonal" onclick={onClose}>{m.boxes_layout_cancel()}</button>
					<button class="btn preset-filled-primary-500" onclick={apply}
						>{m.boxes_layout_apply()}</button
					>
				</div>
			</footer>
		</div>
	</div>
{/if}
