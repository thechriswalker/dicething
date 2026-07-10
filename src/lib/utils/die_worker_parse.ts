import type { Dice } from '$lib/interfaces/storage.svelte';
import { Vector2 } from 'three';

type Defined<T> = T extends undefined ? never : T;
export const dieJsonReviver: Defined<Parameters<typeof JSON.parse>[1]> = (_key, value) => {
	if (typeof value === 'object' && value && value._ === 'v2') {
		return new Vector2(value.x, value.y);
	}
	return value;
};

export function parseDieJson(json: string): Dice {
	return JSON.parse(json, dieJsonReviver) as Dice;
}
