// Shared cache key for die preview thumbnails (worker RAM, IndexedDB, static).

import type { Dice } from '$lib/interfaces/storage.svelte';

export function diePreviewCacheKey(
	d: Pick<
		Dice,
		'kind' | 'parameters' | 'face_parameters' | 'string_parameters' | 'legend_ordering'
	>,
	legendSetId: string,
	legendUpdated?: number
): string {
	return JSON.stringify({
		kind: d.kind,
		legendSetId,
		legendUpdated,
		parameters: d.parameters,
		face_parameters: d.face_parameters,
		string_parameters: d.string_parameters ?? {},
		legend_ordering: d.legend_ordering
	});
}

/** True when the die matches the catalogue default used for static previews. */
export function isCatalogueDiePreview(die: Dice): boolean {
	if (Object.keys(die.parameters ?? {}).length > 0) {
		return false;
	}
	if ((die.face_parameters?.length ?? 0) > 0) {
		return false;
	}
	if (die.string_parameters && Object.keys(die.string_parameters).length > 0) {
		return false;
	}
	const ordering = die.legend_ordering;
	if (ordering && ordering !== 'standard') {
		return false;
	}
	return true;
}
