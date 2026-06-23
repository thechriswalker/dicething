// Helpers for laying dice faces out flat in the XY plane for the "exploded" view.
//
// A face's geometry is built from its 2D `shape` in the XY plane at the origin,
// so an explode transform only needs to translate the (already flat) shape onto
// a grid cell. The builder decomposes the resulting Transform into position +
// quaternion and animates the face Group toward it.

import { Box2, Shape, Vector2, Vector3 } from 'three';
import { Transform } from './3d';
import { getBoundingBox } from './shapes';

export type GridOptions = {
	// number of columns; defaults to ceil(sqrt(n)) for a roughly square grid.
	columns?: number;
	// gap between cells (mm). cells are sized to the largest shape plus this gap.
	gap?: number;
	// where to center the grid (defaults to the origin). used to stack blocks.
	origin?: Vector2;
	// force a minimum cell size (e.g. to align multiple blocks of different
	// shapes). the actual cell never shrinks below what the shapes need.
	cellW?: number;
	cellH?: number;
};

export type GridMeasurement = {
	columns: number;
	rows: number;
	cellW: number;
	cellH: number;
	width: number;
	height: number;
	boxes: Array<Box2>;
};

// measure the grid that gridExplode would produce for the given shapes.
// useful for stacking multiple blocks (e.g. number faces above blank caps).
export function measureGrid(shapes: Array<Shape>, opts: GridOptions = {}): GridMeasurement {
	const n = shapes.length;
	const gap = opts.gap ?? 2;
	const columns = Math.max(1, opts.columns ?? Math.ceil(Math.sqrt(n)));
	const rows = Math.max(1, Math.ceil(n / columns));
	const boxes = shapes.map((s) => getBoundingBox(s));
	const widest = boxes.reduce((m, b) => Math.max(m, b.max.x - b.min.x), 0);
	const tallest = boxes.reduce((m, b) => Math.max(m, b.max.y - b.min.y), 0);
	const cellW = Math.max(widest + gap, opts.cellW ?? 0);
	const cellH = Math.max(tallest + gap, opts.cellH ?? 0);
	return {
		columns,
		rows,
		cellW,
		cellH,
		width: columns * cellW,
		height: rows * cellH,
		boxes
	};
}

// produce a translate-only Transform per shape that lays it flat in a centered
// grid (row-major order). each shape's bounding-box center lands on its cell
// center so shapes of differing sizes don't overlap.
export function gridExplode(shapes: Array<Shape>, opts: GridOptions = {}): Array<Transform> {
	const m = measureGrid(shapes, opts);
	const ox = opts.origin?.x ?? 0;
	const oy = opts.origin?.y ?? 0;
	const startX = ox - m.width / 2 + m.cellW / 2;
	const startY = oy + m.height / 2 - m.cellH / 2;

	return shapes.map((s, i) => {
		const col = i % m.columns;
		const row = Math.floor(i / m.columns);
		const cellCx = startX + col * m.cellW;
		const cellCy = startY - row * m.cellH;
		const box = m.boxes[i];
		const bcx = (box.min.x + box.max.x) / 2;
		const bcy = (box.min.y + box.max.y) / 2;
		return new Transform().translate(new Vector3(cellCx - bcx, cellCy - bcy, 0));
	});
}

type ExplodableFace = {
	isNumberFace: boolean;
	// faces hidden from the UI (e.g. the coin's rim/bevel segments) are not laid
	// out in the grid; they're flung out of shot instead.
	hidden?: boolean;
	shape: Shape;
	explodeTransform?: Transform;
};

// hidden faces (e.g. the coin's rim/bevel segments) aren't laid out in the grid.
// instead they fan out evenly around a big circle and fly to just behind the
// explode-view camera plane, so they sweep out of shot along distinct paths
// rather than all streaking along the same line (and far enough that the tween
// reads as motion, not a teleport).
const HIDDEN_EXPLODE_RADIUS = 250;
// the explode-view camera sits at z = 100 looking at the origin; ending just
// behind it (slightly larger z) clears the view with minimal extra travel.
const HIDDEN_EXPLODE_Z = 110;

export type StackedExplodeOptions = {
	gap?: number;
	// columns for the number-face block; defaults to "all in one row".
	numberColumns?: number;
	// columns for the blank-cap block; defaults to the number-face columns so
	// the caps sit directly beneath the numbers.
	capColumns?: number;
};

// lay number faces in a block on top of a block of blank caps. cells are sized
// from ALL faces so the two blocks share a common grid pitch and line up. by
// default number faces form a single row with the caps tucked underneath.
export function stackedExplode(faces: Array<ExplodableFace>, opts: StackedExplodeOptions = {}) {
	const gap = opts.gap ?? 2;
	// hidden faces are never laid out in the grid. fan them evenly around a circle
	// and fly them to just behind the explode camera, so they sweep out of shot
	// along distinct paths.
	const hidden = faces.filter((f) => f.hidden);
	hidden.forEach((f, i) => {
		const theta = (i / Math.max(1, hidden.length)) * Math.PI * 2;
		f.explodeTransform = new Transform().translate(
			new Vector3(
				Math.cos(theta) * HIDDEN_EXPLODE_RADIUS,
				Math.sin(theta) * HIDDEN_EXPLODE_RADIUS,
				HIDDEN_EXPLODE_Z
			)
		);
	});
	const visible = faces.filter((f) => !f.hidden);
	const numbers = visible.filter((f) => f.isNumberFace);
	const caps = visible.filter((f) => !f.isNumberFace);

	// uniform cell pitch derived from every (visible) face.
	const all = measureGrid(
		visible.map((f) => f.shape),
		{ gap }
	);
	const cell = { gap, cellW: all.cellW, cellH: all.cellH };

	const numberColumns = Math.max(1, opts.numberColumns ?? numbers.length);
	const capColumns = Math.max(1, opts.capColumns ?? numberColumns);

	const numMeasure = measureGrid(
		numbers.map((f) => f.shape),
		{ ...cell, columns: numberColumns }
	);
	const capMeasure = measureGrid(
		caps.map((f) => f.shape),
		{ ...cell, columns: capColumns }
	);

	const totalH = numMeasure.height + (caps.length ? capMeasure.height + gap : 0);
	const numCenterY = totalH / 2 - numMeasure.height / 2;
	const capCenterY = -totalH / 2 + capMeasure.height / 2;

	const numT = gridExplode(
		numbers.map((f) => f.shape),
		{ ...cell, columns: numberColumns, origin: new Vector2(0, numCenterY) }
	);
	numbers.forEach((f, i) => (f.explodeTransform = numT[i]));

	if (caps.length) {
		const capT = gridExplode(
			caps.map((f) => f.shape),
			{ ...cell, columns: capColumns, origin: new Vector2(0, capCenterY) }
		);
		caps.forEach((f, i) => (f.explodeTransform = capT[i]));
	}
}
