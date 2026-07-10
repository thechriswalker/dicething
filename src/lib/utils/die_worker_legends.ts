import { blanks, isBuiltin, loadBuiltinById } from '$lib/fonts';
import { loadMutableLegends, type LegendSet, type SerialisedLegendSet } from './legends';

export async function resolveWorkerLegends(
	json: string | undefined,
	legendSetId: string
): Promise<LegendSet> {
	if (json) {
		const serial = JSON.parse(json) as SerialisedLegendSet;
		if (isBuiltin(serial.id)) {
			return loadBuiltinById(serial.id);
		}
		return loadMutableLegends(serial);
	}
	if (isBuiltin(legendSetId)) {
		return loadBuiltinById(legendSetId);
	}
	return blanks;
}
