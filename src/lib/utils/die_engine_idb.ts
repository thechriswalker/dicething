// Shared IndexedDB layer for sets, legends, and font blobs. Main thread only.

export const DB_NAME = 'dicething';
export const DB_VERSION = 2;
export const STORE_FONTS = 'fonts';
export const STORE_SETS = 'sets';
export const STORE_LEGENDS = 'legends';

let dbPromise: Promise<IDBDatabase> | null = null;

function canUseIdb(): boolean {
	return typeof indexedDB !== 'undefined';
}

export function openEngineDb(): Promise<IDBDatabase> {
	if (!canUseIdb()) {
		return Promise.reject(new Error('IndexedDB is not available'));
	}
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE_FONTS)) {
					db.createObjectStore(STORE_FONTS);
				}
				if (!db.objectStoreNames.contains(STORE_SETS)) {
					db.createObjectStore(STORE_SETS);
				}
				if (!db.objectStoreNames.contains(STORE_LEGENDS)) {
					db.createObjectStore(STORE_LEGENDS);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
	return dbPromise;
}

function run<T>(
	store: string,
	mode: IDBTransactionMode,
	fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	return openEngineDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(store, mode);
				const req = fn(tx.objectStore(store));
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			})
	);
}

export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
	await run(store, 'readwrite', (s) => s.put(value, key));
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
	const v = await run<T | undefined>(store, 'readonly', (s) => s.get(key));
	return v ?? undefined;
}

export async function idbDelete(store: string, key: string): Promise<void> {
	await run(store, 'readwrite', (s) => s.delete(key));
}

export async function idbGetAllKeys(store: string): Promise<Array<string>> {
	const keys = await run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
	return keys.map(String);
}

export async function idbGetAll<T>(store: string): Promise<Array<{ key: string; value: T }>> {
	const db = await openEngineDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly');
		const os = tx.objectStore(store);
		let keys: Array<IDBValidKey> = [];
		let values: T[] = [];
		os.getAllKeys().onsuccess = (e) => {
			keys = (e.target as IDBRequest<IDBValidKey[]>).result;
		};
		os.getAll().onsuccess = (e) => {
			values = (e.target as IDBRequest<T[]>).result;
		};
		tx.oncomplete = () => {
			resolve(keys.map((key, i) => ({ key: String(key), value: values[i] })));
		};
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

// Font helpers (same store as legacy fontstore.ts)
export async function idbPutFont(id: string, data: ArrayBuffer): Promise<void> {
	await idbPut(STORE_FONTS, id, data);
}

export async function idbGetFont(id: string): Promise<ArrayBuffer | undefined> {
	return idbGet<ArrayBuffer>(STORE_FONTS, id);
}

export async function idbDeleteFont(id: string): Promise<void> {
	await idbDelete(STORE_FONTS, id);
}

export async function idbHasFont(id: string): Promise<boolean> {
	const key = await run<IDBValidKey | undefined>(STORE_FONTS, 'readonly', (s) => s.getKey(id));
	return key !== undefined;
}

// Bridge for legacy fontstore.ts on main thread during transition.
export function isEngineIdbAvailable(): boolean {
	return typeof window !== 'undefined' && canUseIdb();
}
