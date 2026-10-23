// Printer build-plate footprints for the export "fit to build plate" option.
//
// Sizes are the horizontal build area in millimetres: X (width) then Y (depth).
// Height is unused — packing only cares about the bed. To add or correct a
// machine, edit BUILD_PLATE_PRESETS. Keys are "Brand / Model"; the brand (the
// text before the first " / ") becomes the dropdown group, in the order the
// keys appear here.

export type PlateSize = { x: number; y: number };

export const CUSTOM_PLATE_ID = 'custom';

/** Preset selected when the user has not chosen one yet. */
export const DEFAULT_BUILD_PLATE_ID = 'Elegoo / Saturn 4 Ultra';

export const BUILD_PLATE_PRESETS: Record<string, PlateSize> = {
	// Elegoo — resin. Volumes from Elegoo's Mars spec table and product pages.
	'Elegoo / Mars 3': { x: 143.43, y: 89.6 },
	'Elegoo / Mars 4': { x: 153.36, y: 77.76 },
	'Elegoo / Mars 4 Ultra': { x: 153.36, y: 77.76 },
	'Elegoo / Mars 4 Max': { x: 195.84, y: 122.4 },
	'Elegoo / Mars 4 DLP': { x: 132.8, y: 74.7 },
	'Elegoo / Mars 5': { x: 143.43, y: 89.6 },
	'Elegoo / Mars 5 Ultra': { x: 153.36, y: 77.76 },
	'Elegoo / Saturn 3': { x: 218.88, y: 122.88 },
	'Elegoo / Saturn 3 Ultra': { x: 218.88, y: 122.88 },
	'Elegoo / Saturn 4': { x: 218.88, y: 122.88 },
	'Elegoo / Saturn 4 Ultra': { x: 218.88, y: 122.88 },
	'Elegoo / Jupiter': { x: 277.848, y: 156.264 },
	'Elegoo / Jupiter 2': { x: 302, y: 162 },

	// Formlabs. Form 4/4B share a bed, as do the L and B variants.
	'Formlabs / Form 3 / 3B': { x: 145, y: 145 },
	'Formlabs / Form 3L / 3BL': { x: 335, y: 200 },
	'Formlabs / Form 4 / 4B': { x: 200, y: 125 },
	'Formlabs / Form 4L / 4BL': { x: 353, y: 196 },

	// Anycubic — resin.
	'Anycubic / Photon Mono 4': { x: 153.4, y: 87 },
	'Anycubic / Photon Mono 4 Ultra': { x: 153.4, y: 87 },
	'Anycubic / Photon Mono X': { x: 192, y: 120 },
	'Anycubic / Photon Mono X 6Ks': { x: 195.84, y: 122.4 },
	'Anycubic / Photon Mono M5s': { x: 218, y: 123 },
	'Anycubic / Photon Mono M7': { x: 223, y: 126 },
	'Anycubic / Photon Mono M7 Pro': { x: 223, y: 126 },
	'Anycubic / Photon Mono M7 Max': { x: 298, y: 164 },

	// Creality — resin.
	'Creality / HALOT-MAGE': { x: 228, y: 128 },
	'Creality / HALOT-MAGE PRO': { x: 228, y: 128 },

	// Phrozen. Sizes from Phrozen's slicer resolution table.
	'Phrozen / Sonic Mini 8K': { x: 165, y: 71.28 },
	'Phrozen / Sonic Mighty 8K': { x: 218.88, y: 123.12 },
	'Phrozen / Sonic Mighty 12K': { x: 218.88, y: 123.12 },
	'Phrozen / Sonic Mighty Revo 14K': { x: 223.78, y: 126.98 },
	'Phrozen / Sonic Mega 8K': { x: 330.24, y: 185.76 },
};

export type BuildPlatePreset = {
	id: string;
	brand: string;
	model: string;
	x: number;
	y: number;
};

/** Dropdown groups, in catalog order. */
export function buildPlatePresetGroups(): Array<{
	brand: string;
	presets: Array<BuildPlatePreset>;
}> {
	const groups: Array<{ brand: string; presets: Array<BuildPlatePreset> }> = [];
	const byBrand = new Map<string, Array<BuildPlatePreset>>();
	for (const [id, size] of Object.entries(BUILD_PLATE_PRESETS)) {
		const slash = id.indexOf(' / ');
		const brand = slash === -1 ? id : id.slice(0, slash);
		const model = slash === -1 ? id : id.slice(slash + 3);
		const preset: BuildPlatePreset = { id, brand, model, x: size.x, y: size.y };
		let list = byBrand.get(brand);
		if (!list) {
			list = [];
			byBrand.set(brand, list);
			groups.push({ brand, presets: list });
		}
		list.push(preset);
	}
	return groups;
}
