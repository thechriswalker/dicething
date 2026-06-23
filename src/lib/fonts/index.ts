// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadImmutableLegends, type LegendSet } from "$lib/utils/legends";
import alice_in_wonderlandSVG from './generated/alice_in_wonderland.svg';
import alice_in_wonderland_100SVG from './generated/alice_in_wonderland_100.svg';
import averiaSVG from './generated/averia.svg';
import averia_100SVG from './generated/averia_100.svg';
import germania_oneSVG from './generated/germania_one.svg';
import germania_one_100SVG from './generated/germania_one_100.svg';
import josefin_mediumSVG from './generated/josefin_medium.svg';
import josefin_medium_100SVG from './generated/josefin_medium_100.svg';
import siamese_katsongSVG from './generated/siamese_katsong.svg';
import siamese_katsong_100SVG from './generated/siamese_katsong_100.svg';
import tekturSVG from './generated/tektur.svg';
import tektur_100SVG from './generated/tektur_100.svg';
import voltaireSVG from './generated/voltaire.svg';
import voltaire_100SVG from './generated/voltaire_100.svg';
import alice_in_wonderlandFontUrl from './builtins/alice_in_wonderland/alice_in_wonderland.ttf?url';
import averiaFontUrl from './builtins/averia/averia.ttf?url';
import germania_oneFontUrl from './builtins/germania_one/germania_one.ttf?url';
import josefin_mediumFontUrl from './builtins/josefin_medium/josefin_medium.ttf?url';
import siamese_katsongFontUrl from './builtins/siamese_katsong/siamese_katsong.ttf?url';
import tekturFontUrl from './builtins/tektur/tektur.ttf?url';
import voltaireFontUrl from './builtins/voltaire/voltaire.ttf?url';
import alice_in_wonderlandLicense from './builtins/alice_in_wonderland/license.txt?raw';
import averiaLicense from './builtins/averia/license.txt?raw';
import germania_oneLicense from './builtins/germania_one/license.txt?raw';
import josefin_mediumLicense from './builtins/josefin_medium/license.txt?raw';
import siamese_katsongLicense from './builtins/siamese_katsong/license.txt?raw';
import tekturLicense from './builtins/tektur/license.txt?raw';
import voltaireLicense from './builtins/voltaire/license.txt?raw';

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
	names: [],
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
	readonly id: BuiltinID;
    readonly name: string;
	readonly tags: Array<string>;
	readonly preview: string;
	// URL to the source TTF (served from the bundle) so the legend editor can
	// generate more glyphs from a clone of this builtin. Empty for blanks.
	readonly fontUrl: string;
	// the font's license text, for attribution/display. Empty for blanks.
	readonly license: string;
    readonly load: () => Promise<ReturnType<typeof loadImmutableLegends>>;
}

type BuiltinID = "blanks"|"alice_in_wonderland"|"alice_in_wonderland_100"|"averia"|"averia_100"|"germania_one"|"germania_one_100"|"josefin_medium"|"josefin_medium_100"|"siamese_katsong"|"siamese_katsong_100"|"tektur"|"tektur_100"|"voltaire"|"voltaire_100";

const builtins: Record<BuiltinID, Builtin> = {
	blanks: { id: "blanks", name: "Blanks", tags: ["blank"], fontUrl: "", license: "", load: async () => blanks, preview: "" } as Builtin,
    alice_in_wonderland: { id: "alice_in_wonderland", name: "Alice In Wonderland", tags: ["std"], preview: alice_in_wonderlandSVG, fontUrl: alice_in_wonderlandFontUrl, license: alice_in_wonderlandLicense, load: deferredFontLoader("alice_in_wonderland") } as Builtin,
    alice_in_wonderland_100: { id: "alice_in_wonderland_100", name: "Alice In Wonderland (100)", tags: ["0-99"], preview: alice_in_wonderland_100SVG, fontUrl: alice_in_wonderlandFontUrl, license: alice_in_wonderlandLicense, load: deferredFontLoader("alice_in_wonderland_100") } as Builtin,
    averia: { id: "averia", name: "Averia", tags: ["std"], preview: averiaSVG, fontUrl: averiaFontUrl, license: averiaLicense, load: deferredFontLoader("averia") } as Builtin,
    averia_100: { id: "averia_100", name: "Averia (100)", tags: ["0-99"], preview: averia_100SVG, fontUrl: averiaFontUrl, license: averiaLicense, load: deferredFontLoader("averia_100") } as Builtin,
    germania_one: { id: "germania_one", name: "Germania One", tags: ["std"], preview: germania_oneSVG, fontUrl: germania_oneFontUrl, license: germania_oneLicense, load: deferredFontLoader("germania_one") } as Builtin,
    germania_one_100: { id: "germania_one_100", name: "Germania One (100)", tags: ["0-99"], preview: germania_one_100SVG, fontUrl: germania_oneFontUrl, license: germania_oneLicense, load: deferredFontLoader("germania_one_100") } as Builtin,
    josefin_medium: { id: "josefin_medium", name: "Josefin Medium", tags: ["std"], preview: josefin_mediumSVG, fontUrl: josefin_mediumFontUrl, license: josefin_mediumLicense, load: deferredFontLoader("josefin_medium") } as Builtin,
    josefin_medium_100: { id: "josefin_medium_100", name: "Josefin Medium (100)", tags: ["0-99"], preview: josefin_medium_100SVG, fontUrl: josefin_mediumFontUrl, license: josefin_mediumLicense, load: deferredFontLoader("josefin_medium_100") } as Builtin,
    siamese_katsong: { id: "siamese_katsong", name: "Siamese Katsong", tags: ["std"], preview: siamese_katsongSVG, fontUrl: siamese_katsongFontUrl, license: siamese_katsongLicense, load: deferredFontLoader("siamese_katsong") } as Builtin,
    siamese_katsong_100: { id: "siamese_katsong_100", name: "Siamese Katsong (100)", tags: ["0-99"], preview: siamese_katsong_100SVG, fontUrl: siamese_katsongFontUrl, license: siamese_katsongLicense, load: deferredFontLoader("siamese_katsong_100") } as Builtin,
    tektur: { id: "tektur", name: "Tektur", tags: ["std"], preview: tekturSVG, fontUrl: tekturFontUrl, license: tekturLicense, load: deferredFontLoader("tektur") } as Builtin,
    tektur_100: { id: "tektur_100", name: "Tektur (100)", tags: ["0-99"], preview: tektur_100SVG, fontUrl: tekturFontUrl, license: tekturLicense, load: deferredFontLoader("tektur_100") } as Builtin,
    voltaire: { id: "voltaire", name: "Voltaire", tags: ["std"], preview: voltaireSVG, fontUrl: voltaireFontUrl, license: voltaireLicense, load: deferredFontLoader("voltaire") } as Builtin,
    voltaire_100: { id: "voltaire_100", name: "Voltaire (100)", tags: ["0-99"], preview: voltaire_100SVG, fontUrl: voltaireFontUrl, license: voltaireLicense, load: deferredFontLoader("voltaire_100") } as Builtin,
} as const;

export const defaultFont = builtins.germania_one;

export default builtins;
