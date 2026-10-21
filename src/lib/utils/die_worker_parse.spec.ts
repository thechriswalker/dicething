import { describe, expect, it } from 'vitest';
import { Vector2 } from 'three';
import { dieJsonReviver } from './die_worker_parse';

describe('dieJsonReviver', () => {
	it('restores tagged Vector2s and plain face offsets', () => {
		const parsed = JSON.parse(
			JSON.stringify({
				face_parameters: [{ offset: { x: 1.5, y: -2 } }, { scale: 1 }],
				tagged: { _: 'v2', x: 3, y: 4 }
			}),
			dieJsonReviver
		);
		expect(parsed.face_parameters[0].offset).toBeInstanceOf(Vector2);
		expect(parsed.face_parameters[0].offset.x).toBe(1.5);
		expect(parsed.face_parameters[0].offset.y).toBe(-2);
		expect(parsed.face_parameters[0].offset.lengthSq()).toBeCloseTo(1.5 * 1.5 + 4);
		expect(parsed.tagged).toBeInstanceOf(Vector2);
		expect(parsed.face_parameters[1].scale).toBe(1);
	});

	it('leaves other objects with x and y alone', () => {
		const parsed = JSON.parse(JSON.stringify({ point: { x: 1, y: 2, z: 3 } }), dieJsonReviver);
		expect(parsed.point).not.toBeInstanceOf(Vector2);
		expect(parsed.point).toEqual({ x: 1, y: 2, z: 3 });
	});
});
