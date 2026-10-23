import { describe, expect, it } from 'vitest';
import { DEFAULT_SUPPORT_LAYER_VISIBILITY, DEFAULT_SUPPORT_SETTINGS } from './types';
import {
	effectiveDieSupports,
	effectiveSetSupports,
	globalSupportConfig,
	parseSupportConfig,
	supportConfigEqual,
	type SupportConfig
} from './config';

function global(): SupportConfig {
	return globalSupportConfig({
		supportSettings: { ...DEFAULT_SUPPORT_SETTINGS, pillarDiameterMm: 0.8 },
		supportLayers: { ...DEFAULT_SUPPORT_LAYER_VISIBILITY }
	});
}

describe('support config resolution', () => {
	it('uses global defaults when the set and die have none', () => {
		const g = global();
		const resolved = effectiveDieSupports({}, {}, g);
		expect(resolved.settings.pillarDiameterMm).toBe(0.8);
		expect(resolved.layers).toEqual(DEFAULT_SUPPORT_LAYER_VISIBILITY);
	});

	it('prefers set defaults over global, and a die override over the set', () => {
		const g = global();
		const set = {
			supports: {
				settings: { ...DEFAULT_SUPPORT_SETTINGS, pillarDiameterMm: 1 },
				layers: { edges: false, legends: true, tipPost: true }
			}
		};
		const fromSet = effectiveDieSupports({}, set, g);
		expect(fromSet.settings.pillarDiameterMm).toBe(1);
		expect(fromSet.layers.edges).toBe(false);

		const die = {
			supports: {
				settings: { ...DEFAULT_SUPPORT_SETTINGS, pillarDiameterMm: 1.5 },
				layers: { edges: true, legends: false, tipPost: false }
			}
		};
		const fromDie = effectiveDieSupports(die, set, g);
		expect(fromDie.settings.pillarDiameterMm).toBe(1.5);
		expect(fromDie.layers.legends).toBe(false);
		expect(effectiveSetSupports(set, g).settings.pillarDiameterMm).toBe(1);
	});

	it('treats a saved config as the global defaults only when every field matches', () => {
		const g = global();
		const same = effectiveSetSupports(
			{
				supports: {
					settings: { ...g.settings },
					layers: { ...g.layers }
				}
			},
			g
		);
		expect(supportConfigEqual(same, g)).toBe(true);
		const changed = effectiveSetSupports(
			{
				supports: {
					settings: { ...g.settings, raftDepthMm: 0 },
					layers: { ...g.layers, tipPost: false }
				}
			},
			g
		);
		expect(supportConfigEqual(changed, g)).toBe(false);
	});

	it('fills missing layers from the defaults when reading a partial blob', () => {
		const parsed = parseSupportConfig({
			settings: { pillarDiameterMm: 1.2 },
			layers: { edges: false }
		});
		expect(parsed?.settings.pillarDiameterMm).toBe(1.2);
		expect(parsed?.settings.coneLengthMm).toBe(DEFAULT_SUPPORT_SETTINGS.coneLengthMm);
		expect(parsed?.layers.edges).toBe(false);
		expect(parsed?.layers.legends).toBe(true);
		expect(parseSupportConfig(null)).toBeUndefined();
		expect(parseSupportConfig({ layers: { edges: true } })).toBeUndefined();
	});
});
