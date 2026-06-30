// Encode a whole dice set into a URL fragment so it can be shared as a link.
// The payload is the same JSON the file export produces (exportSetJson), but
// deflate-compressed and base64url-encoded so it survives in a URL. We put it in
// the fragment (#…) rather than the query/path so it never reaches a server:
// the app is a static client-side site and the data can be large.
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { isBuiltin } from '$lib/fonts';
import type { DiceSet } from '$lib/interfaces/storage.svelte';
import { exportSetJson } from './export';

// Practical URL-length guidance. Browsers happily handle far longer, but other
// surfaces (chat apps, link unfurlers, QR codes) start to mangle or refuse long
// URLs. Below SAFE is shareable anywhere; between SAFE and WARN works but is
// risky; above WARN we steer the user to file export instead.
export const SHARE_URL_SAFE_LENGTH = 2000;
export const SHARE_URL_WARN_LENGTH = 8000;

function toBase64Url(bytes: Uint8Array): string {
	let bin = '';
	// build the binary string in chunks to avoid blowing the argument limit of
	// String.fromCharCode for large payloads.
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): Uint8Array {
	const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		out[i] = bin.charCodeAt(i);
	}
	return out;
}

// Compress + encode an exported-set JSON string into a fragment-safe token.
export function encodeShareData(json: string): string {
	return toBase64Url(deflateSync(strToU8(json), { level: 9 }));
}

// Reverse encodeShareData. Throws if the token is not valid compressed data.
export function decodeShareData(token: string): string {
	return strFromU8(inflateSync(fromBase64Url(token)));
}

// The JSON we put in a share link: only the legends the dice actually use, and
// for built-in legend sets nothing but the id (the importer rebuilds them from
// the bundle), keeping the link as small as possible.
export function shareJsonForSet(set: DiceSet): string {
	return exportSetJson(set, {
		embedLegends: isBuiltin(set.legends.id) ? 'reference' : 'used'
	});
}

// Build the full share URL for a set against the given origin (e.g.
// location.origin). The encoded set lives in the fragment.
export function buildShareUrl(set: DiceSet, origin: string): string {
	return `${origin}/s#${encodeShareData(shareJsonForSet(set))}`;
}

export type ShareSize = 'ok' | 'large' | 'huge';

export function classifyShareUrl(url: string): ShareSize {
	if (url.length <= SHARE_URL_SAFE_LENGTH) {
		return 'ok';
	}
	if (url.length <= SHARE_URL_WARN_LENGTH) {
		return 'large';
	}
	return 'huge';
}
