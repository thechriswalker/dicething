// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadImmutableLegends, type LegendSet } from "$lib/utils/legends";

const deferredFontLoader = (fontname: string) => {
	const fn = async () => {
		const data = await import(`./generated/${fontname}.json`);
		return loadImmutableLegends(data);
	}
	let promise: ReturnType<typeof fn>;
	return () => {
		if(!promise) {
			promise = fn();
		}
		return promise;
	}
}

// all blanks
export const blanks = loadImmutableLegends({
	id: 'builtin:blanks',
	name: 'Blanks',
	shapes: []
});

export function isBuiltin(id: string): boolean {
	return id.startsWith('builtin:');
}

export async function loadBuiltinById(id: string): Promise<LegendSet> {
	if(!isBuiltin(id)) {
		return blanks;
	}
	const key = id.slice(8) as keyof typeof builtins;
	return builtins[key].load();
}

export type Builtin = {
    readonly name: string;
    readonly load: () => Promise<ReturnType<typeof loadImmutableLegends>>;
}

const builtins = {
	blanks: { name: "Blanks", load: async () => blanks },
    alice_in_wonderland: { name: "Alice In Wonderland", load: deferredFontLoader("alice_in_wonderland") } as Builtin,
    alice_in_wonderland_100: { name: "Alice In Wonderland (100)", load: deferredFontLoader("alice_in_wonderland_100") } as Builtin,
    averia: { name: "Averia", load: deferredFontLoader("averia") } as Builtin,
    averia_100: { name: "Averia (100)", load: deferredFontLoader("averia_100") } as Builtin,
    germania_one: { name: "Germania One", load: deferredFontLoader("germania_one") } as Builtin,
    germania_one_100: { name: "Germania One (100)", load: deferredFontLoader("germania_one_100") } as Builtin,
    siamese_katsong: { name: "Siamese Katsong", load: deferredFontLoader("siamese_katsong") } as Builtin,
    siamese_katsong_100: { name: "Siamese Katsong (100)", load: deferredFontLoader("siamese_katsong_100") } as Builtin,
    tektur: { name: "Tektur", load: deferredFontLoader("tektur") } as Builtin,
    tektur_100: { name: "Tektur (100)", load: deferredFontLoader("tektur_100") } as Builtin,
    voltaire: { name: "Voltaire", load: deferredFontLoader("voltaire") } as Builtin,
    voltaire_100: { name: "Voltaire (100)", load: deferredFontLoader("voltaire_100") } as Builtin,
} as const;

export default builtins;
