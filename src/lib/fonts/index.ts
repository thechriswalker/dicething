// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
import { loadImmutableLegends, type LegendSet } from "$lib/utils/legends";
import alice_in_wonderlandSVG from './generated/alice_in_wonderland.svg';
import averiaSVG from './generated/averia.svg';
import germania_oneSVG from './generated/germania_one.svg';
import josefin_mediumSVG from './generated/josefin_medium.svg';
import mononokiSVG from './generated/mononoki.svg';
import siamese_katsongSVG from './generated/siamese_katsong.svg';
import tekturSVG from './generated/tektur.svg';
import voltaireSVG from './generated/voltaire.svg';
import alice_in_wonderlandFontUrl from './builtins/alice_in_wonderland/alice_in_wonderland.ttf?url';
import averiaFontUrl from './builtins/averia/averia.ttf?url';
import germania_oneFontUrl from './builtins/germania_one/germania_one.ttf?url';
import josefin_mediumFontUrl from './builtins/josefin_medium/josefin_medium.ttf?url';
import mononokiFontUrl from './builtins/mononoki/mononoki.ttf?url';
import siamese_katsongFontUrl from './builtins/siamese_katsong/siamese_katsong.ttf?url';
import tekturFontUrl from './builtins/tektur/tektur.ttf?url';
import voltaireFontUrl from './builtins/voltaire/voltaire.ttf?url';
import alice_in_wonderlandLicense from './builtins/alice_in_wonderland/license.txt?raw';
import averiaLicense from './builtins/averia/license.txt?raw';
import germania_oneLicense from './builtins/germania_one/license.txt?raw';
import josefin_mediumLicense from './builtins/josefin_medium/license.txt?raw';
import mononokiLicense from './builtins/mononoki/license.txt?raw';
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
	readonly preview: string;
	// URL to the source TTF (served from the bundle) so the legend editor can
	// generate more glyphs from a clone of this builtin. Empty for blanks.
	readonly fontUrl: string;
	// the font's license text, for attribution/display. Empty for blanks.
	readonly license: string;
    readonly load: () => Promise<ReturnType<typeof loadImmutableLegends>>;
}

type BuiltinID = "blanks"|"alice_in_wonderland"|"averia"|"germania_one"|"josefin_medium"|"mononoki"|"siamese_katsong"|"tektur"|"voltaire";

const builtins: Record<BuiltinID, Builtin> = {
	blanks: { id: "blanks", name: "Blanks", fontUrl: "", license: "", load: async () => blanks, preview: "" } as Builtin,
    alice_in_wonderland: { id: "alice_in_wonderland", name: "Alice In Wonderland", preview: alice_in_wonderlandSVG, fontUrl: alice_in_wonderlandFontUrl, license: alice_in_wonderlandLicense, load: deferredFontLoader("alice_in_wonderland") } as Builtin,
    averia: { id: "averia", name: "Averia", preview: averiaSVG, fontUrl: averiaFontUrl, license: averiaLicense, load: deferredFontLoader("averia") } as Builtin,
    germania_one: { id: "germania_one", name: "Germania One", preview: germania_oneSVG, fontUrl: germania_oneFontUrl, license: germania_oneLicense, load: deferredFontLoader("germania_one") } as Builtin,
    josefin_medium: { id: "josefin_medium", name: "Josefin Medium", preview: josefin_mediumSVG, fontUrl: josefin_mediumFontUrl, license: josefin_mediumLicense, load: deferredFontLoader("josefin_medium") } as Builtin,
    mononoki: { id: "mononoki", name: "Mononoki", preview: mononokiSVG, fontUrl: mononokiFontUrl, license: mononokiLicense, load: deferredFontLoader("mononoki") } as Builtin,
    siamese_katsong: { id: "siamese_katsong", name: "Siamese Katsong", preview: siamese_katsongSVG, fontUrl: siamese_katsongFontUrl, license: siamese_katsongLicense, load: deferredFontLoader("siamese_katsong") } as Builtin,
    tektur: { id: "tektur", name: "Tektur", preview: tekturSVG, fontUrl: tekturFontUrl, license: tekturLicense, load: deferredFontLoader("tektur") } as Builtin,
    voltaire: { id: "voltaire", name: "Voltaire", preview: voltaireSVG, fontUrl: voltaireFontUrl, license: voltaireLicense, load: deferredFontLoader("voltaire") } as Builtin,
} as const;

export const defaultFont = builtins.germania_one;

export default builtins;
