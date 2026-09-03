// Persistent die-preview cache in IndexedDB.
//
// Only custom (non-builtin) legend sets are stored — builtins ship as static
// WebPs. Eviction is by whole legend set (LRU): when over cap, the least-
// recently-used custom legend's previews are dropped together. Legend delete /
// save also clears that legend's entries.

import { isBuiltin } from '$lib/fonts';
import {
	idbGet,
	idbGetAll,
	idbGetAllKeys,
	idbPut,
	openEngineDb,
	STORE_DIE_PREVIEW_LRU,
	STORE_DIE_PREVIEWS
} from '$lib/utils/die_engine_idb';

/** Max number of distinct custom legend sets kept in the preview cache. */
export const MAX_CACHED_PREVIEW_LEGEND_SETS = 16;

export type DiePreviewRecord = {
	key: string;
	legendSetId: string;
	blob: Blob;
	accessedAt: number;
};

export type DiePreviewLruRecord = {
	accessedAt: number;
};

function canUse(): boolean {
	return typeof indexedDB !== 'undefined';
}

export async function idbGetDiePreview(key: string): Promise<Blob | undefined> {
	if (!canUse()) {
		return undefined;
	}
	const rec = await idbGet<DiePreviewRecord>(STORE_DIE_PREVIEWS, key);
	return rec?.blob;
}

export async function idbTouchDiePreview(key: string, legendSetId: string): Promise<void> {
	if (!canUse() || isBuiltin(legendSetId)) {
		return;
	}
	const now = Date.now();
	const rec = await idbGet<DiePreviewRecord>(STORE_DIE_PREVIEWS, key);
	if (rec) {
		await idbPut(STORE_DIE_PREVIEWS, key, { ...rec, accessedAt: now });
	}
	await idbPut(STORE_DIE_PREVIEW_LRU, legendSetId, {
		accessedAt: now
	} satisfies DiePreviewLruRecord);
}

export async function idbPutDiePreview(
	key: string,
	legendSetId: string,
	blob: Blob
): Promise<void> {
	if (!canUse() || isBuiltin(legendSetId)) {
		return;
	}
	const now = Date.now();
	const rec: DiePreviewRecord = { key, legendSetId, blob, accessedAt: now };
	await idbPut(STORE_DIE_PREVIEWS, key, rec);
	await idbPut(STORE_DIE_PREVIEW_LRU, legendSetId, {
		accessedAt: now
	} satisfies DiePreviewLruRecord);
	await evictDiePreviewLegendsIfNeeded();
}

export async function idbDeleteDiePreviewsForLegend(legendSetId: string): Promise<void> {
	if (!canUse()) {
		return;
	}
	const db = await openEngineDb();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction([STORE_DIE_PREVIEWS, STORE_DIE_PREVIEW_LRU], 'readwrite');
		const previews = tx.objectStore(STORE_DIE_PREVIEWS);
		const lru = tx.objectStore(STORE_DIE_PREVIEW_LRU);
		const index = previews.index('legendSetId');
		const req = index.openCursor(IDBKeyRange.only(legendSetId));
		req.onsuccess = () => {
			const cursor = req.result;
			if (cursor) {
				cursor.delete();
				cursor.continue();
			}
		};
		lru.delete(legendSetId);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

/** Pure helper for tests: which legend ids to drop given LRU timestamps. */
export function pickLegendSetsToEvict(
	entries: Array<{ legendSetId: string; accessedAt: number }>,
	maxSets: number
): Array<string> {
	if (entries.length <= maxSets) {
		return [];
	}
	const sorted = [...entries].sort((a, b) => a.accessedAt - b.accessedAt);
	return sorted.slice(0, entries.length - maxSets).map((e) => e.legendSetId);
}

async function evictDiePreviewLegendsIfNeeded(): Promise<void> {
	const all = await idbGetAll<DiePreviewLruRecord>(STORE_DIE_PREVIEW_LRU);
	const custom = all
		.filter(({ key }) => !isBuiltin(key))
		.map(({ key, value }) => ({
			legendSetId: key,
			accessedAt: value?.accessedAt ?? 0
		}));
	const drop = pickLegendSetsToEvict(custom, MAX_CACHED_PREVIEW_LEGEND_SETS);
	for (const id of drop) {
		await idbDeleteDiePreviewsForLegend(id);
	}
}

/** Test/debug: count distinct custom legend sets currently tracked. */
export async function idbCountCachedPreviewLegendSets(): Promise<number> {
	if (!canUse()) {
		return 0;
	}
	const keys = await idbGetAllKeys(STORE_DIE_PREVIEW_LRU);
	return keys.filter((k) => !isBuiltin(k)).length;
}
