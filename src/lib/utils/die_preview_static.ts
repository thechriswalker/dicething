// Build-time / static catalogue die thumbnails under /previews/{kind}/{legend}.webp

import { isBuiltin } from '$lib/fonts';
import type { Dice } from '$lib/interfaces/storage.svelte';
import type { LegendSet } from '$lib/utils/legends';
import { isCatalogueDiePreview } from '$lib/utils/die_preview_key';

/** Strip `builtin:` so filenames stay short and URL-safe. */
export function legendPreviewSlug(legendSetId: string): string {
	return isBuiltin(legendSetId) ? legendSetId.slice('builtin:'.length) : legendSetId;
}

export function staticDiePreviewUrl(kind: string, legendSetId: string): string {
	return `/previews/${kind}/${legendPreviewSlug(legendSetId)}.webp`;
}

export const BLANKS_LEGEND_ID = 'builtin:blanks';

export function staticBlanksPreviewUrl(kind: string): string {
	return staticDiePreviewUrl(kind, BLANKS_LEGEND_ID);
}

/** Builtin catalogue tiles can use shipped WebPs; custom legends cannot. */
export function canUseStaticDiePreview(die: Dice, legends: LegendSet): boolean {
	return isBuiltin(legends.id) && isCatalogueDiePreview(die);
}
