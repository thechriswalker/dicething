import { browser } from '$app/environment';

function attemptJSONParse<T>(s: string | null): T | undefined {
	if (!s) {
		return undefined;
	}
	try {
		return JSON.parse(s) as T;
	} catch {
		return undefined;
	}
}

const appPrefix = `dt:`;

class LocalStore<T> {
	private key = '';
	value = $state<T>() as T;

	constructor(key: string, value: T) {
		this.key = appPrefix + key;
		this.value = value;

		if (browser) {
			const item = attemptJSONParse<T>(localStorage.getItem(key));
			if (item) {
				this.value = item;
			}
			$effect(() => {
				localStorage.setItem(this.key, JSON.stringify(this.value));
			});
		}
	}
}

export function localStore<T>(key: string, value: T) {
	return new LocalStore(key, value);
}
