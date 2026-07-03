import { describe, it, expect } from 'vitest';
import { MAGNET_PRINTIN_BRIDGE_MM, magnetPauseZ } from './box_builder';
import { defaultBoxParams } from './types';

describe('magnetPauseZ', () => {
	it('returns seam minus the print-in bridge thickness', () => {
		const p = defaultBoxParams();
		p.magnets.enabled = true;
		p.magnets.mode = 'printin';
		expect(magnetPauseZ(p, 15)).toBe(15 - MAGNET_PRINTIN_BRIDGE_MM);
	});

	it('is undefined for push-in magnets', () => {
		const p = defaultBoxParams();
		p.magnets.enabled = true;
		p.magnets.mode = 'pushin';
		expect(magnetPauseZ(p, 15)).toBeUndefined();
	});

	it('is undefined when magnets are disabled', () => {
		const p = defaultBoxParams();
		p.magnets.enabled = false;
		expect(magnetPauseZ(p, 15)).toBeUndefined();
	});
});
