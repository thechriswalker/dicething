import type { Dice, DiceSet } from './storage.svelte';

export type UnidentifiedDiceSet = Omit<DiceSet, 'id' | 'updated' | 'dice'> & {
	dice: Array<Omit<Dice, 'id'>>;
};

export type Preset = () => UnidentifiedDiceSet | Promise<UnidentifiedDiceSet>;
