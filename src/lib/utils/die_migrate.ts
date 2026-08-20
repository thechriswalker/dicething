// Migrate legacy d00_* (percentile) die kinds onto their d10_* equivalents.
//
// Historically d% dice were separate registry entries whose build() baked in
// tens legends. They are now the same shape as d10 with `legend_ordering:
// 'percentile'`. Saved sets / imports still carry d00_* kinds; this module
// rewrites them in place so subsequent saves persist the new form.
//
// Ordering remap when kind becomes d10_*:
//   undefined | 'standard'  → 'percentile'   (d00 default was tens)
//   'units'                 → 'standard'     (explicit units on a d00)
//   'percentile'            → 'percentile'
//   'spindown'              → 'custom' with the old d00 spindown legends baked
//                             into face_parameters (d10 spindown uses unit glyphs)
//   'custom' / other        → kept as-is

import dice from '$lib/dice';
import type { FaceParams } from '$lib/interfaces/dice';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import {
	CUSTOM_ORDERING,
	PERCENTILE_ORDERING,
	STANDARD_ORDERING,
	UNITS_ORDERING
} from '$lib/utils/legend_orderings';
import { spindownOrders } from '$lib/utils/spindown_orders';

/** d00_* kind → canonical d10_* kind. */
export const D10_BY_D00 = {
	d00_crystal: 'd10_crystal',
	d00_trapezohedron: 'd10_trapezohedron',
	d00_barrel: 'd10_barrel'
} as const satisfies Partial<Record<keyof typeof dice, keyof typeof dice>>;

/** d10_* kind → legacy d00_* twin (picker previews / i18n names). */
export const D00_BY_D10 = {
	d10_crystal: 'd00_crystal',
	d10_trapezohedron: 'd00_trapezohedron',
	d10_barrel: 'd00_barrel'
} as const satisfies Partial<Record<keyof typeof dice, keyof typeof dice>>;

export type D00Kind = keyof typeof D10_BY_D00;
export type D10PercentileKind = keyof typeof D00_BY_D10;

export function isD00Kind(kind: string): kind is D00Kind {
	return kind in D10_BY_D00;
}

export function isD10PercentilePair(kind: string): boolean {
	return kind in D00_BY_D10 || kind in D10_BY_D00;
}

/** Picker chose a d00_* tile → add the d10_* with percentile ordering. */
export function resolvePickerSelection(kind: keyof typeof dice): {
	kind: keyof typeof dice;
	legend_ordering: string;
} {
	if (isD00Kind(kind)) {
		return { kind: D10_BY_D00[kind], legend_ordering: PERCENTILE_ORDERING };
	}
	return { kind, legend_ordering: STANDARD_ORDERING };
}

function bakeLegacySpindown(die: Dice, oldKind: D00Kind): Array<FaceParams> {
	const legends = spindownOrders[oldKind];
	const model = dice[oldKind];
	if (!legends || !model) {
		return die.face_parameters ?? [];
	}
	const faces = model.build(die.parameters, die.string_parameters ?? {}).faces;
	const fps: Array<FaceParams> = (die.face_parameters ?? []).map((fp) => ({ ...fp }));
	while (fps.length < faces.length) {
		fps.push({});
	}
	let n = 0;
	for (let i = 0; i < faces.length; i++) {
		if (!faces[i].isNumberFace) {
			continue;
		}
		if (n < legends.length) {
			fps[i] = { ...fps[i], legend: legends[n] };
			n++;
		}
	}
	return fps;
}

/** Rewrite one die. Returns a new object when changed, else the same reference. */
export function migrateLegacyDie(die: Dice): Dice {
	if (!isD00Kind(die.kind)) {
		// leftover 'units' on an already-migrated d10 (shouldn't happen, but cheap).
		if (die.legend_ordering === UNITS_ORDERING) {
			return { ...die, legend_ordering: STANDARD_ORDERING };
		}
		return die;
	}

	const newKind = D10_BY_D00[die.kind];
	const ordering = die.legend_ordering ?? STANDARD_ORDERING;

	if (ordering === UNITS_ORDERING) {
		return { ...die, kind: newKind, legend_ordering: STANDARD_ORDERING };
	}
	if (ordering === 'spindown') {
		return {
			...die,
			kind: newKind,
			legend_ordering: CUSTOM_ORDERING,
			face_parameters: bakeLegacySpindown(die, die.kind)
		};
	}
	if (ordering === STANDARD_ORDERING || ordering === PERCENTILE_ORDERING) {
		return { ...die, kind: newKind, legend_ordering: PERCENTILE_ORDERING };
	}
	// custom / unknown: keep ordering, only rewrite kind.
	return { ...die, kind: newKind };
}

export function migrateLegacyDice(list: Array<Dice>): { dice: Array<Dice>; changed: boolean } {
	let changed = false;
	const diceOut = list.map((d) => {
		const next = migrateLegacyDie(d);
		if (next !== d) {
			changed = true;
		}
		return next;
	});
	return { dice: changed ? diceOut : list, changed };
}

/** Mutate a set's dice array in place. Returns true if anything changed. */
export function migrateLegacyDiceSet(set: DiceSet): boolean {
	const { dice, changed } = migrateLegacyDice(set.dice);
	if (changed) {
		set.dice = dice;
	}
	return changed;
}
