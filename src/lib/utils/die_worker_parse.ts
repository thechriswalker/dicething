import type { Dice } from '$lib/interfaces/storage.svelte';
import { Vector2 } from 'three';

type Defined<T> = T extends undefined ? never : T;
export const dieJsonReviver: Defined<Parameters<typeof JSON.parse>[1]> = (key, value) => {
	if (typeof value === 'object' && value) {
		if (value._ === 'v2') {
			return new Vector2(value.x, value.y);
		}
		// Face offsets are Vector2s. JSON.stringify without the storage replacer
		// drops the `{_: 'v2'}` tag and leaves a plain `{x, y}`, which then throws
		// on `.lengthSq()` during support placement.
		if (
			key === 'offset' &&
			typeof value.x === 'number' &&
			typeof value.y === 'number' &&
			Object.keys(value).every((k) => k === 'x' || k === 'y')
		) {
			return new Vector2(value.x, value.y);
		}
	}
	return value;
};

export function parseDieJson(json: string): Dice {
	return JSON.parse(json, dieJsonReviver) as Dice;
}
