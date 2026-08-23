/**
 * App-only URL scheme used inside composition HTML while it lives in the
 * editor. The native layer rewrites these to `file:///` URLs exclusively
 * inside isolated render/studio directories.
 */
export const INTERNAL_MEDIA_SCHEME = "opencut-media";

function percentEncodePath(path: string): string {
	let out = "";
	for (const byte of new TextEncoder().encode(path)) {
		const isUnreserved =
			(byte >= 0x41 && byte <= 0x5a) ||
			(byte >= 0x61 && byte <= 0x7a) ||
			(byte >= 0x30 && byte <= 0x39) ||
			byte === 0x2d ||
			byte === 0x5f ||
			byte === 0x2e ||
			byte === 0x7e;
		out += isUnreserved ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
	}
	return out;
}

export function internalMediaUrl(absolutePath: string): string {
	return `${INTERNAL_MEDIA_SCHEME}://local/${percentEncodePath(absolutePath)}`;
}

/** Returns the decoded filesystem path from an internal media URL. */
export function parseInternalMediaUrl(url: string): string | null {
	const prefix = `${INTERNAL_MEDIA_SCHEME}://local/`;
	if (!url.startsWith(prefix)) {
		return null;
	}
	const encoded = url.slice(prefix.length);
	try {
		return decodeURIComponent(encoded);
	} catch {
		return encoded;
	}
}

export function isInternalMediaUrl(url: string): boolean {
	return url.startsWith(`${INTERNAL_MEDIA_SCHEME}://local/`);
}
