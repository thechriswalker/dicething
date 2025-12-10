// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadImmutableLegends, type LegendSet } from "$lib/utils/legends";
import alice_in_wonderlandSVG from './generated/alice_in_wonderland.svg';
import alice_in_wonderland_100SVG from './generated/alice_in_wonderland_100.svg';
import averiaSVG from './generated/averia.svg';
import averia_100SVG from './generated/averia_100.svg';
import germania_oneSVG from './generated/germania_one.svg';
import germania_one_100SVG from './generated/germania_one_100.svg';
import siamese_katsongSVG from './generated/siamese_katsong.svg';
import siamese_katsong_100SVG from './generated/siamese_katsong_100.svg';
import tekturSVG from './generated/tektur.svg';
import tektur_100SVG from './generated/tektur_100.svg';
import voltaireSVG from './generated/voltaire.svg';
import voltaire_100SVG from './generated/voltaire_100.svg';

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
	readonly tags: Array<string>;
	readonly preview: string;
    readonly load: () => Promise<ReturnType<typeof loadImmutableLegends>>;
}

const builtins = {
	blanks: { name: "Blanks", tags: ["blank"], load: async () => blanks, preview: "" } as Builtin,
    alice_in_wonderland: { name: "Alice In Wonderland", tags: ["std"], preview: alice_in_wonderlandSVG, load: deferredFontLoader("alice_in_wonderland") } as Builtin,
    alice_in_wonderland_100: { name: "Alice In Wonderland (100)", tags: ["0-99"], preview: alice_in_wonderland_100SVG, load: deferredFontLoader("alice_in_wonderland_100") } as Builtin,
    averia: { name: "Averia", tags: ["std"], preview: averiaSVG, load: deferredFontLoader("averia") } as Builtin,
    averia_100: { name: "Averia (100)", tags: ["0-99"], preview: averia_100SVG, load: deferredFontLoader("averia_100") } as Builtin,
    germania_one: { name: "Germania One", tags: ["std"], preview: germania_oneSVG, load: deferredFontLoader("germania_one") } as Builtin,
    germania_one_100: { name: "Germania One (100)", tags: ["0-99"], preview: germania_one_100SVG, load: deferredFontLoader("germania_one_100") } as Builtin,
    siamese_katsong: { name: "Siamese Katsong", tags: ["std"], preview: siamese_katsongSVG, load: deferredFontLoader("siamese_katsong") } as Builtin,
    siamese_katsong_100: { name: "Siamese Katsong (100)", tags: ["0-99"], preview: siamese_katsong_100SVG, load: deferredFontLoader("siamese_katsong_100") } as Builtin,
    tektur: { name: "Tektur", tags: ["std"], preview: tekturSVG, load: deferredFontLoader("tektur") } as Builtin,
    tektur_100: { name: "Tektur (100)", tags: ["0-99"], preview: tektur_100SVG, load: deferredFontLoader("tektur_100") } as Builtin,
    voltaire: { name: "Voltaire", tags: ["std"], preview: voltaireSVG, load: deferredFontLoader("voltaire") } as Builtin,
    voltaire_100: { name: "Voltaire (100)", tags: ["0-99"], preview: voltaire_100SVG, load: deferredFontLoader("voltaire_100") } as Builtin,
} as const;

export const defaultFont = builtins.germania_one;

export default builtins;
