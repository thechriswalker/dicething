// Resolve legend sets for the offscreen die-preview worker. Builtins load from
// the bundle by id (no postMessage transfer). Custom sets are fetched from the
// main thread on demand (workers have no localStorage) and cached by id.
import { isBuiltin, loadBuiltinById } from '$lib/fonts';
import { loadImmutableLegends, type LegendSet, type SerialisedLegendSet } from './legends';

type CacheEntry = { updated?: number; serialised: SerialisedLegendSet };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<LegendSet>>();

// Mutable sets may hold live THREE.Shape instances (setSerialized / font import).
// JSON.stringify calls toJSON(), which encodes shapes; parse back to a plain tree
// safe for structured clone.
export function serialiseLegendSetForWorker(set: LegendSet): SerialisedLegendSet | undefined {
	if (!set.mutable) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(set)) as SerialisedLegendSet;
}

function requestCustomLegends(id: string): Promise<SerialisedLegendSet> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			self.removeEventListener('message', onMessage);
			reject(new Error(`timed out waiting for legend set ${id}`));
		}, 10_000);

		function onMessage(event: MessageEvent) {
			if (event.data?.msg === 'legends' && event.data.id === id) {
				clearTimeout(timeout);
				self.removeEventListener('message', onMessage);
				resolve(event.data.legends as SerialisedLegendSet);
			}
		}
		self.addEventListener('message', onMessage);
		postMessage({ msg: 'need-legends', id });
	});
}

export async function resolvePreviewLegends(
	id: string,
	updated?: number,
	inline?: SerialisedLegendSet
): Promise<LegendSet> {
	if (inline) {
		return loadImmutableLegends(inline);
	}
	if (isBuiltin(id)) {
		return loadBuiltinById(id);
	}
	const hit = cache.get(id);
	if (hit && hit.updated === updated) {
		return loadImmutableLegends(hit.serialised);
	}
	let pending = inflight.get(id);
	if (!pending) {
		pending = requestCustomLegends(id)
			.then((serialised) => {
				cache.set(id, { updated, serialised });
				inflight.delete(id);
				return loadImmutableLegends(serialised);
			})
			.catch((err) => {
				inflight.delete(id);
				throw err;
			});
		inflight.set(id, pending);
	}
	return pending;
}
