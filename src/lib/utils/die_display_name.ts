// Display names for dice instances: the shape label (from i18n) plus any
// numbering-driven swap (D10 ↔ D%) and ordering suffix (Spindown, Go First).
//
// Instances are always d10_* after migration; percentile numbering is an
// ordering. Legacy d00_* i18n keys are still used for the "D% …" label when
// that ordering is active (and for picker tiles that still reference d00_*).

import dice from '$lib/dice';
import { m } from '$lib/paraglide/messages';
import { D00_BY_D10, D10_BY_D00, isD00Kind } from '$lib/utils/die_migrate';
import { PERCENTILE_ORDERING, STANDARD_ORDERING } from '$lib/utils/legend_orderings';

export { PERCENTILE_ORDERING };

/** True when the effective numbering is tens (00–90) rather than units (0–9). */
export function usesPercentileNumbering(kind: string, ordering: string | undefined): boolean {
	const id = ordering ?? STANDARD_ORDERING;
	if (id === PERCENTILE_ORDERING) {
		return true;
	}
	// legacy unmigrated d00_* with standard/spindown/custom still read as D%.
	if (isD00Kind(kind) && id !== 'units') {
		return true;
	}
	return false;
}

/** Kind whose `dice_name` i18n entry matches the effective D10/D% label. */
export function displayNameKind(
	kind: keyof typeof dice,
	ordering: string | undefined
): keyof typeof dice {
	const percentile = usesPercentileNumbering(kind, ordering);
	if (percentile) {
		return (D00_BY_D10[kind as keyof typeof D00_BY_D10] as keyof typeof dice | undefined) ?? kind;
	}
	return (D10_BY_D00[kind as keyof typeof D10_BY_D00] as keyof typeof dice | undefined) ?? kind;
}

/**
 * Localised shape name for a die instance, reflecting numbering and ordering.
 * Does not include a user nickname.
 */
export function dieDisplayName(kind: keyof typeof dice, ordering: string | undefined): string {
	const nameKind = displayNameKind(kind, ordering);
	let name = m.dice_name({ kind: nameKind });
	const id = ordering ?? STANDARD_ORDERING;
	if (id === 'spindown' || id.startsWith('go_first')) {
		name = `${name} ${m.legend_ordering_option({ key: id })}`;
	}
	return name;
}

/** Prefer nickname when set; otherwise the shape display name. */
export function dieListLabel(
	kind: keyof typeof dice,
	ordering: string | undefined,
	nickname: string | undefined
): string {
	const nick = nickname?.trim();
	if (nick) {
		return nick;
	}
	return dieDisplayName(kind, ordering);
}
