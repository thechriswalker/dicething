// The static top-down figure the layout editor draws: body octagon, recess,
// magnet dots, and each included die's hull. Shared with the box picker so a
// card can show the layout without building the 3D box.

import { Vector2 } from 'three';
import { boxOutline, rotateHull, type PreparedLayout } from './box_builder';
import type { BoxConfig } from './types';

export const BOX_LAYOUT_COLOURS = [
	'#22d3ee',
	'#a78bfa',
	'#f472b6',
	'#facc15',
	'#34d399',
	'#fb923c',
	'#60a5fa'
];

export type LayoutFigureDie = {
	points: Array<Vector2>;
	// index in the prepared dice list, so the colour matches the layout editor.
	index: number;
};

export type LayoutFigure = {
	body: Array<Vector2>;
	inner: Array<Vector2>;
	corners: Array<Vector2>;
	magRadius: number;
	dice: Array<LayoutFigureDie>;
};

export function layoutFigure(prep: PreparedLayout, config: BoxConfig): LayoutFigure {
	const p = config.params;
	const manual = p.manual && p.box.halfX > 0 && p.box.halfY > 0;
	const byId = new Map(config.placements.map((pl) => [pl.dieId, pl]));
	const dice: Array<LayoutFigureDie> = [];
	const hullPts: Array<Vector2> = [];
	prep.dice.forEach((d, index) => {
		if (!d.include) {
			return;
		}
		const pl = byId.get(d.dieId);
		const x = manual ? (pl?.x ?? d.autoPos.x) : d.autoPos.x;
		const y = manual ? (pl?.y ?? d.autoPos.y) : d.autoPos.y;
		const rotation = pl?.rotation ?? 0;
		const points = rotateHull(d.hull0, rotation).map((pt) => new Vector2(pt.x + x, pt.y + y));
		dice.push({ points, index });
		hullPts.push(...points);
	});
	const half = manual
		? new Vector2(p.box.halfX, p.box.halfY)
		: new Vector2(prep.box.halfX, prep.box.halfY);
	const outline = boxOutline(p, half, hullPts);
	return {
		body: outline.body,
		inner: outline.inner,
		corners: outline.corners,
		magRadius: outline.magRadius,
		dice
	};
}
