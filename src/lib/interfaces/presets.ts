import type { Dice, DiceSet } from './storage.svelte';

export type UnidentifiedDiceSet = Omit<DiceSet, 'name' | 'id' | 'updated' | 'dice'> & {
	dice: Array<Omit<Dice, 'id'>>;
};

type MaybePromise<T> = T | Promise<T>;


export type PresetOption = PresetOptionBoolean | PresetOptionSelection | PresetOptionRange | PresetOptionLegend | PresetOptionDie;

export type PresetOptionBoolean = {
	id: string;
	kind: "bool"
	value: boolean;
}

export type PresetOptionSelection = {
	id: string;
	kind: "select";
	options: Array<[string, string]>;// value, label
	value: string;
}

export type PresetOptionRange = {
	id: string;
	kind: "range";
	min: number;
	max: number;
	step: number;
	value: number;
}

export type PresetOptionLegend = {
	id: string;
	kind: "legend",
	value: string;
}

// pick one die shape from a list of die kinds, shown as blank 3D previews.
export type PresetOptionDie = {
	id: string;
	kind: "die";
	// die kinds to offer (keys of the dice registry).
	options: Array<string>;
	value: string;
}



export type Preset = {
	id: string;
	options: () => Array<PresetOption>;
	factory: (opts: Array<PresetOption>) => MaybePromise<UnidentifiedDiceSet>;
}