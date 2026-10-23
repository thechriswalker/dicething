import {
	DEFAULT_SUPPORT_LAYER_VISIBILITY,
	DEFAULT_SUPPORT_SETTINGS,
	mergeSupportSettings,
	type SupportLayerVisibility,
	type SupportSettings
} from './types';

/** Sizes plus which support layers are included. Stored at global, set, and die scope. */
export type SupportConfig = {
	settings: SupportSettings;
	layers: SupportLayerVisibility;
};

export function cloneSupportConfig(config: SupportConfig): SupportConfig {
	return {
		settings: mergeSupportSettings(config.settings),
		layers: {
			edges: config.layers?.edges ?? DEFAULT_SUPPORT_LAYER_VISIBILITY.edges,
			legends: config.layers?.legends ?? DEFAULT_SUPPORT_LAYER_VISIBILITY.legends,
			tipPost: config.layers?.tipPost ?? DEFAULT_SUPPORT_LAYER_VISIBILITY.tipPost
		}
	};
}

export function supportConfigEqual(a: SupportConfig, b: SupportConfig): boolean {
	return JSON.stringify(cloneSupportConfig(a)) === JSON.stringify(cloneSupportConfig(b));
}

/** Accept a saved blob (possibly partial or from an older build) or reject it. */
export function parseSupportConfig(raw: unknown): SupportConfig | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const o = raw as { settings?: unknown; layers?: unknown };
	if (!o.settings || typeof o.settings !== 'object') {
		return undefined;
	}
	const layers =
		o.layers && typeof o.layers === 'object' ? (o.layers as Partial<SupportLayerVisibility>) : {};
	return cloneSupportConfig({
		settings: { ...DEFAULT_SUPPORT_SETTINGS, ...(o.settings as Partial<SupportSettings>) },
		layers: { ...DEFAULT_SUPPORT_LAYER_VISIBILITY, ...layers }
	});
}

export function globalSupportConfig(prefs: {
	supportSettings: SupportSettings;
	supportLayers: SupportLayerVisibility;
}): SupportConfig {
	return cloneSupportConfig({
		settings: prefs.supportSettings,
		layers: prefs.supportLayers
	});
}

/** Set defaults when the set has its own, otherwise the global defaults. */
export function effectiveSetSupports(
	set: { supports?: SupportConfig } | undefined,
	global: SupportConfig
): SupportConfig {
	return set?.supports ? cloneSupportConfig(set.supports) : cloneSupportConfig(global);
}

/** Die override, else the set defaults, else the global defaults. */
export function effectiveDieSupports(
	die: { supports?: SupportConfig } | undefined,
	set: { supports?: SupportConfig } | undefined,
	global: SupportConfig
): SupportConfig {
	if (die?.supports) {
		return cloneSupportConfig(die.supports);
	}
	return effectiveSetSupports(set, global);
}

export function normalizeStoredSupports(set: {
	supports?: unknown;
	dice: Array<{ supports?: unknown }>;
}): void {
	const setSupports = parseSupportConfig(set.supports);
	if (setSupports) {
		set.supports = setSupports;
	} else {
		delete set.supports;
	}
	for (const die of set.dice) {
		const dieSupports = parseSupportConfig(die.supports);
		if (dieSupports) {
			die.supports = dieSupports;
		} else {
			delete die.supports;
		}
	}
}
