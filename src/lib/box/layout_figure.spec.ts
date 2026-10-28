import { describe, expect, it } from 'vitest';
import { Vector2, Vector3 } from 'three';
import { defaultBoxConfig } from './store';
import { layoutFigure } from './layout_figure';
import type { PreparedLayout } from './box_builder';
import type { Dice } from '$lib/interfaces/storage.svelte';

function die(id: string): Dice {
	return { id, kind: 'd6_cube', parameters: {}, face_parameters: [] };
}

function prep(): PreparedLayout {
	const hull0 = [new Vector2(-1, -1), new Vector2(1, -1), new Vector2(1, 1), new Vector2(-1, 1)];
	return {
		box: { halfX: 40, halfY: 12 },
		dice: [
			{
				dieId: 'a',
				kind: 'd6_cube',
				hull0,
				size: new Vector3(2, 2, 2),
				autoPos: new Vector2(5, 0),
				include: true
			},
			{
				dieId: 'b',
				kind: 'd6_cube',
				hull0,
				size: new Vector3(2, 2, 2),
				autoPos: new Vector2(-5, 0),
				include: false
			}
		]
	};
}

describe('layoutFigure', () => {
	it('draws included dice at the auto-layout position', () => {
		const config = defaultBoxConfig('set', [die('a'), die('b')], 'Box', 'box');
		const figure = layoutFigure(prep(), config);
		expect(figure.dice).toHaveLength(1);
		expect(figure.dice[0].index).toBe(0);
		expect(figure.dice[0].points.some((p) => Math.abs(p.x - 6) < 1e-6)).toBe(true);
		expect(Math.max(...figure.body.map((p) => Math.abs(p.x)))).toBeCloseTo(40);
		expect(Math.max(...figure.body.map((p) => Math.abs(p.y)))).toBeCloseTo(12);
	});

	it('uses the saved manual placement and box size', () => {
		const config = defaultBoxConfig('set', [die('a'), die('b')], 'Box', 'box');
		config.params.manual = true;
		config.params.box = { halfX: 50, halfY: 20 };
		config.placements[0].x = 30;
		config.placements[0].y = -4;
		const figure = layoutFigure(prep(), config);
		expect(figure.dice[0].points.some((p) => Math.abs(p.x - 31) < 1e-6)).toBe(true);
		expect(Math.max(...figure.body.map((p) => Math.abs(p.x)))).toBeCloseTo(50);
		expect(Math.max(...figure.body.map((p) => Math.abs(p.y)))).toBeCloseTo(20);
	});
});
