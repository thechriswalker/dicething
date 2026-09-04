import type { Dice, DiceSet } from './storage.svelte';

export type UnidentifiedDiceSet = Omit<DiceSet, 'name' | 'id' | 'updated' | 'dice'> & {
	dice: Array<Omit<Dice, 'id'>>;
};

type MaybePromise<T> = T | Promise<T>;

// Gate an option's visibility on another option's current value (e.g. only show
// the d6 shape picker when players === '3'). An array for `equals` matches any.
export type PresetOptionVisibleWhen = {
	option: string;
	equals: string | number | boolean | Array<string | number | boolean>;
};

type PresetOptionBase = {
	id: string;
	visibleWhen?: PresetOptionVisibleWhen;
};

export type PresetOption =
	| PresetOptionBoolean
	| PresetOptionSelection
	| PresetOptionRange
	| PresetOptionLegend
	| PresetOptionDie;

export type PresetOptionBoolean = PresetOptionBase & {
	kind: 'bool';
	value: boolean;
};

export type PresetOptionSelection = PresetOptionBase & {
	kind: 'select';
	options: Array<[string, string]>; // value, label
	value: string;
};

export type PresetOptionRange = PresetOptionBase & {
	kind: 'range';
	min: number;
	max: number;
	step: number;
	value: number;
};

export type PresetOptionLegend = PresetOptionBase & {
	kind: 'legend';
	value: string;
	// When set, only builtins with this characterSet are offered (customs hidden).
	characterSet?: 'default' | 'five_player';
};

// pick one die shape from a list of die kinds, shown as blank 3D previews.
export type PresetOptionDie = PresetOptionBase & {
	kind: 'die';
	// die kinds to offer (keys of the dice registry).
	options: Array<string>;
	value: string;
};

export type Preset = {
	id: string;
	options: () => Array<PresetOption>;
	factory: (opts: Array<PresetOption>) => MaybePromise<UnidentifiedDiceSet>;
};

/** Whether a preset option should be shown given the current option values. */
export function isPresetOptionVisible(
	opt: PresetOption,
	valuesById: Record<string, string | number | boolean | undefined>
): boolean {
	const cond = opt.visibleWhen;
	if (!cond) {
		return true;
	}
	const current = valuesById[cond.option];
	const targets = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
	return targets.some((t) => t === current);
}
