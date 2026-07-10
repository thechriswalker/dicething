// Persistent store for *uploaded* source fonts (TTF/OTF ArrayBuffers), keyed by
// the legend set id they belong to. Builtin fonts are served from the bundle
// (see $lib/fonts) and are never stored here.
//
// Uses the shared die-engine IndexedDB (see die_engine_idb.ts).
import {
	idbDeleteFont,
	idbGetFont,
	idbHasFont,
	idbPutFont,
	isEngineIdbAvailable
} from '$lib/utils/die_engine_idb';

export async function putFont(id: string, data: ArrayBuffer): Promise<void> {
	if (!isEngineIdbAvailable()) {
		return;
	}
	await idbPutFont(id, data);
}

export async function getFont(id: string): Promise<ArrayBuffer | undefined> {
	if (!isEngineIdbAvailable()) {
		return undefined;
	}
	return idbGetFont(id);
}

export async function deleteFont(id: string): Promise<void> {
	if (!isEngineIdbAvailable()) {
		return;
	}
	await idbDeleteFont(id);
}

export async function hasFont(id: string): Promise<boolean> {
	if (!isEngineIdbAvailable()) {
		return false;
	}
	return idbHasFont(id);
}
