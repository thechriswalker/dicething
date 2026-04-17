import type { Dice, DiceSet } from './storage.svelte';

export type UnidentifiedDiceSet = Omit<DiceSet, 'name' | 'id' | 'updated' | 'dice'> & {
	dice: Array<Omit<Dice, 'id'>>;
};

type MaybePromise<T> = T | Promise<T>;


export type PresetOption = PresetOptionBoolean | PresetOptionSelection | PresetOptionRange | PresetOptionLegend;

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
	filter: string;
	value: string;
}



export type Preset = {
	id: string;
	options: () => Array<PresetOption>;
	factory: (opts: Array<PresetOption>) => MaybePromise<UnidentifiedDiceSet>;
}