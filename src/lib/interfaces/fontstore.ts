// Persistent store for *uploaded* source fonts (TTF/OTF ArrayBuffers), keyed by
// the legend set id they belong to. Builtin fonts are served from the bundle
// (see $lib/fonts) and are never stored here.
//
// We use IndexedDB rather than localStorage because font binaries are large
// (tens to hundreds of KB) and would quickly exhaust the ~5MB localStorage
// quota that holds the legend shape data and dice sets.
import { browser } from '$app/environment';

const DB_NAME = 'dicething';
const DB_VERSION = 1;
const STORE = 'fonts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (!browser) {
		return Promise.reject(new Error('IndexedDB is only available in the browser'));
	}
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE)) {
					db.createObjectStore(STORE);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
	return dbPromise;
}

function run<T>(
	mode: IDBTransactionMode,
	fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE, mode);
				const req = fn(tx.objectStore(STORE));
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			})
	);
}

export async function putFont(id: string, data: ArrayBuffer): Promise<void> {
	await run('readwrite', (s) => s.put(data, id));
}

export async function getFont(id: string): Promise<ArrayBuffer | undefined> {
	const data = await run<ArrayBuffer | undefined>('readonly', (s) => s.get(id));
	return data ?? undefined;
}

export async function deleteFont(id: string): Promise<void> {
	await run('readwrite', (s) => s.delete(id));
}

export async function hasFont(id: string): Promise<boolean> {
	const key = await run<IDBValidKey | undefined>('readonly', (s) => s.getKey(id));
	return key !== undefined;
}
