import { describe, expect, it } from 'vitest';
import {
	LEGEND_SCALING_AUTO,
	LEGEND_SCALING_INDIVIDUAL,
	LEGEND_SCALING_UNIFORM,
	resolveIndividualLegendScaling
} from './builder';

describe('resolveIndividualLegendScaling', () => {
	it('uses the model preference when mode is auto or unset', () => {
		expect(resolveIndividualLegendScaling(true, undefined)).toBe(true);
		expect(resolveIndividualLegendScaling(false, undefined)).toBe(false);
		expect(resolveIndividualLegendScaling(true, LEGEND_SCALING_AUTO)).toBe(true);
		expect(resolveIndividualLegendScaling(false, LEGEND_SCALING_AUTO)).toBe(false);
	});

	it('forces individual or uniform regardless of model preference', () => {
		expect(resolveIndividualLegendScaling(false, LEGEND_SCALING_INDIVIDUAL)).toBe(true);
		expect(resolveIndividualLegendScaling(true, LEGEND_SCALING_UNIFORM)).toBe(false);
	});
});
