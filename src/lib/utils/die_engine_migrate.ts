// Migrate dice sets and custom legends from localStorage into IndexedDB, then
// remove the migrated keys. Runs on the main thread (workers cannot read LS).
import { LEGENDS_STORAGE_PREFIX } from './legend_storage';
import { idbPut, STORE_LEGENDS, STORE_SETS } from './die_engine_idb';

const LOCALSTORAGE_PREFIX = 'dt:';
const DICE_SETS_PREFIX = LOCALSTORAGE_PREFIX + 'sets:';
const LEGENDS_PREFIX = LEGENDS_STORAGE_PREFIX;

let migrated = false;

export async function migrateLocalStorageToIdb(): Promise<void> {
	if (migrated || typeof localStorage === 'undefined') {
		return;
	}
	migrated = true;

	const setKeys: Array<string> = [];
	const legendKeys: Array<string> = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key) {
			continue;
		}
		if (key.startsWith(DICE_SETS_PREFIX)) {
			setKeys.push(key);
		} else if (key.startsWith(LEGENDS_PREFIX)) {
			legendKeys.push(key);
		}
	}

	for (const key of setKeys) {
		const raw = localStorage.getItem(key);
		if (!raw) {
			continue;
		}
		try {
			const id = key.slice(DICE_SETS_PREFIX.length);
			await idbPut(STORE_SETS, id, raw);
			localStorage.removeItem(key);
		} catch (e) {
			console.warn('failed to migrate set', key, e);
		}
	}

	for (const key of legendKeys) {
		const raw = localStorage.getItem(key);
		if (!raw) {
			continue;
		}
		try {
			const id = key.slice(LEGENDS_PREFIX.length);
			await idbPut(STORE_LEGENDS, id, raw);
			localStorage.removeItem(key);
		} catch (e) {
			console.warn('failed to migrate legend', key, e);
		}
	}
}

export { DICE_SETS_PREFIX, LEGENDS_PREFIX, LOCALSTORAGE_PREFIX };
