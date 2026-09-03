import { describe, it, expect } from 'vitest';
import {
	dieDisplayName,
	dieListLabel,
	usesPercentileNumbering
} from '$lib/utils/die_display_name';

describe('die display names', () => {
	it('uses D10 by default and D% when percentile ordering is selected', () => {
		expect(dieDisplayName('d10_trapezohedron', undefined)).toBe('D10 Trapezohedron');
		expect(dieDisplayName('d10_trapezohedron', 'standard')).toBe('D10 Trapezohedron');
		expect(dieDisplayName('d10_trapezohedron', 'percentile')).toBe('D% Trapezohedron');
	});

	it('still labels unmigrated d00 kinds as D%', () => {
		expect(dieDisplayName('d00_trapezohedron', undefined)).toBe('D% Trapezohedron');
	});

	it('appends Spindown / Go First / Dicething / Chessex suffixes', () => {
		expect(dieDisplayName('d12_dodecahedron', 'spindown')).toBe('D12 Dodecahedron Spindown');
		expect(dieDisplayName('d12_dodecahedron', 'go_first_a')).toBe(
			'D12 Dodecahedron Go First (A)'
		);
		expect(dieDisplayName('d12_dodecahedron', 'dicething')).toBe('D12 Dodecahedron Dicething');
		expect(dieDisplayName('d12_tetartoid', 'chessex')).toBe('D12 Skew Chessex');
	});

	it('prefer nickname in list labels', () => {
		expect(dieListLabel('d20_icosahedron', undefined, 'Logo')).toBe('Logo');
		expect(dieListLabel('d20_icosahedron', undefined, '  ')).toBe('D20 Icosahedron');
	});

	it('usesPercentileNumbering follows ordering (and legacy d00 kinds)', () => {
		expect(usesPercentileNumbering('d10_crystal', 'standard')).toBe(false);
		expect(usesPercentileNumbering('d10_crystal', 'percentile')).toBe(true);
		expect(usesPercentileNumbering('d00_crystal', 'standard')).toBe(true);
		expect(usesPercentileNumbering('d00_crystal', 'units')).toBe(false);
	});
});
