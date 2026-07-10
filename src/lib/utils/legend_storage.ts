import type { SerialisedLegendSet } from './legends';

export const LEGENDS_STORAGE_PREFIX = 'dt:legends:';

// Read a custom legend set's serialised form from localStorage (main thread only).
export function readCustomLegendSerialised(id: string): SerialisedLegendSet | undefined {
	if (typeof localStorage === 'undefined') {
		return undefined;
	}
	const raw = localStorage.getItem(LEGENDS_STORAGE_PREFIX + id);
	if (!raw) {
		return undefined;
	}
	try {
		return JSON.parse(raw) as SerialisedLegendSet;
	} catch {
		return undefined;
	}
}
