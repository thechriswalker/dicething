import { describe, it, expect } from 'vitest';
import { magnetPauseZ } from './box_builder';
import { defaultBoxParams } from './types';

describe('magnetPauseZ', () => {
	it('returns seam minus the print-in cover thickness', () => {
		const p = defaultBoxParams();
		p.magnets.enabled = true;
		p.magnets.mode = 'printin';
		expect(magnetPauseZ(p, 15)).toBe(15 - p.magnets.cover);
	});

	it('tracks a custom cover thickness', () => {
		const p = defaultBoxParams();
		p.magnets.enabled = true;
		p.magnets.mode = 'printin';
		p.magnets.cover = 0.8;
		expect(magnetPauseZ(p, 15)).toBe(14.2);
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
