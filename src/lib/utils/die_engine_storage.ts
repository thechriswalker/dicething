// IndexedDB-backed storage. All reads/writes run on the main thread (see
// die_engine_client.ts); the worker does not touch IDB.
import type { SerialisedLegendSet } from './legends';
import type { StorageDiceSetSnapshot, StorageUpdatedPayload } from './die_engine_protocol';
import {
	idbDelete,
	idbDeleteFont,
	idbGet,
	idbGetAll,
	idbPut,
	STORE_LEGENDS,
	STORE_SETS
} from './die_engine_idb';

export async function loadStorageSnapshot(): Promise<StorageUpdatedPayload> {
	const [setEntries, legendEntries] = await Promise.all([
		idbGetAll<string>(STORE_SETS),
		idbGetAll<string>(STORE_LEGENDS)
	]);

	const sets: Array<StorageDiceSetSnapshot> = [];
	for (const { key, value } of setEntries) {
		try {
			const stored = JSON.parse(value) as {
				id: string;
				name: string;
				updated: number;
				dice: unknown;
				legends: string;
			};
			sets.push({
				id: stored.id ?? key,
				name: stored.name,
				updated: stored.updated,
				dice: JSON.stringify(stored.dice),
				legendsId: stored.legends
			});
		} catch {
			await idbDelete(STORE_SETS, key);
		}
	}

	const legends: Array<SerialisedLegendSet> = [];
	for (const { key, value } of legendEntries) {
		try {
			const obj = JSON.parse(value) as SerialisedLegendSet;
			legends.push({ ...obj, id: obj.id ?? key });
		} catch {
			await idbDelete(STORE_LEGENDS, key);
		}
	}

	return { sets, legends };
}

export async function saveSetRecord(setJson: string): Promise<void> {
	const stored = JSON.parse(setJson) as { id: string };
	await idbPut(STORE_SETS, stored.id, setJson);
}

export async function deleteSetRecord(setId: string): Promise<void> {
	await idbDelete(STORE_SETS, setId);
}

export async function saveLegendRecord(legendJson: string): Promise<void> {
	const stored = JSON.parse(legendJson) as { id: string };
	await idbPut(STORE_LEGENDS, stored.id, legendJson);
}

export async function deleteLegendRecord(legendId: string): Promise<void> {
	await idbDelete(STORE_LEGENDS, legendId);
	try {
		await idbDeleteFont(legendId);
	} catch {
		// font blob may not exist
	}
}

export async function getSetRecord(setId: string): Promise<string | undefined> {
	return idbGet<string>(STORE_SETS, setId);
}

export async function getLegendRecord(legendId: string): Promise<string | undefined> {
	return idbGet<string>(STORE_LEGENDS, legendId);
}
