import { describe, expect, it } from 'vitest';
import { Legend } from './legends';
import { getOrComputeLegendScaling, clearLegendScalingCache } from './legend_scaling_cache';
import type { DieFaceModel } from '$lib/interfaces/dice';
import { Shape } from 'three';

describe('legend_scaling_cache', () => {
	it('reuses cached scaling for identical inputs', () => {
		clearLegendScalingCache();
		const square = new Shape();
		square.moveTo(-10, -10);
		square.lineTo(10, -10);
		square.lineTo(10, 10);
		square.lineTo(-10, 10);
		square.closePath();

		const face: DieFaceModel = {
			shape: square,
			isNumberFace: true,
			defaultLegend: Legend.ONE,
			transform: { applyToGeometry: () => {}, applyRotationToCamera: () => {} } as never,
			hidden: false
		};

		const legends = {
			id: 'test',
			name: 'test',
			mutable: false,
			length: 1,
			get: () => {
				const pip = new Shape();
				pip.absarc(0, 0, 2, 0, Math.PI * 2, false);
				return [pip];
			},
			getLegendName: () => 'one',
			toJSON: () => ({ id: 'test', name: 'test', shapes: [] }),
			[Symbol.iterator]: function* () {
				yield Legend.ONE;
			}
		};

		const inputs = {
			modelId: 'd6_cube',
			legends,
			dieParams: { engraving_depth: 0.8, engraving_tolerance: 0.5 },
			stringParams: {},
			ordering: 'standard',
			tolerance: 0.5,
			faces: [face],
			faceLegend: (_i: number, f: DieFaceModel) => f.defaultLegend
		};

		const first = getOrComputeLegendScaling(inputs);
		const second = getOrComputeLegendScaling(inputs);
		expect(second).toBe(first);
		expect(first.smallest).toBeGreaterThan(0);
	});

	it('does not reuse scaling across different face sizes', () => {
		clearLegendScalingCache();
		const makeFace = (size: number): DieFaceModel => {
			const square = new Shape();
			square.moveTo(-size, -size);
			square.lineTo(size, -size);
			square.lineTo(size, size);
			square.lineTo(-size, size);
			square.closePath();
			return {
				shape: square,
				isNumberFace: true,
				defaultLegend: Legend.ONE,
				transform: { applyToGeometry: () => {}, applyRotationToCamera: () => {} } as never,
				hidden: false
			};
		};

		const legends = {
			id: 'test',
			name: 'test',
			mutable: false,
			length: 1,
			get: () => {
				const pip = new Shape();
				pip.absarc(0, 0, 6, 0, Math.PI * 2, false);
				return [pip];
			},
			getLegendName: () => 'one',
			toJSON: () => ({ id: 'test', name: 'test', shapes: [] }),
			[Symbol.iterator]: function* () {
				yield Legend.ONE;
			}
		};

		const base = {
			modelId: 'd20_icosahedron',
			legends,
			stringParams: {},
			ordering: 'standard',
			tolerance: 0.5,
			faceLegend: (_i: number, f: DieFaceModel) => f.defaultLegend
		};

		const large = getOrComputeLegendScaling({
			...base,
			dieParams: { engraving_depth: 0.8, engraving_tolerance: 0.5 },
			faces: [makeFace(10)]
		});
		const small = getOrComputeLegendScaling({
			...base,
			dieParams: {
				engraving_depth: 0.8,
				engraving_tolerance: 0.5,
				polyhedron_size: 12
			},
			faces: [makeFace(4)]
		});

		expect(small).not.toBe(large);
		expect(small.smallest).toBeLessThan(large.smallest);
	});
});
