import { describe, expect, it } from 'vitest';
import { Shape, Vector2 } from 'three';
import type { LegendSet } from './legends';
import { computeEngravingBoundsErrors } from './engraving_bounds';

function legendsOf(glyph: Shape): LegendSet {
	return {
		id: 'test',
		name: 'test',
		mutable: false,
		length: 1,
		get: () => [glyph],
		getLegendName: () => '1',
		toJSON: () => ({ id: 'test', name: 'test', shapes: [] }),
		[Symbol.iterator]: function* () {}
	};
}

const square = new Shape([
	new Vector2(-0.5, -0.5),
	new Vector2(0.5, -0.5),
	new Vector2(0.5, 0.5),
	new Vector2(-0.5, 0.5)
]);

describe('computeEngravingBoundsErrors', () => {
	it('flags a face whose explicit scale no longer fits', () => {
		const errors = computeEngravingBoundsErrors(
			{
				id: 'd',
				kind: 'd6_cube',
				parameters: {},
				face_parameters: [{ scale: 40 }]
			},
			legendsOf(square)
		);
		expect(errors.some((e) => e.faceIndex === 0 && e.reason === 'symbol-too-large')).toBe(true);
	});

	it('accepts the same glyph once it is auto-scaled to the face', () => {
		const errors = computeEngravingBoundsErrors(
			{
				id: 'd',
				kind: 'd6_cube',
				parameters: {},
				face_parameters: []
			},
			legendsOf(square)
		);
		expect(errors).toEqual([]);
	});
});
