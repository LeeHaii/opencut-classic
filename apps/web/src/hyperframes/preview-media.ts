const MAX_CACHED_PREVIEW_MEDIA_ENTRIES = 6;
const MAX_CACHED_PREVIEW_MEDIA_CHARACTERS = 32 * 1024 * 1024;

interface CachedPreviewMedia {
	html: string;
	size: number;
}

export interface ResolvedHyperframesPreviewMedia {
	elementId: string;
	source: string;
	html: string;
}

const resolvedPreviewMedia = new Map<string, CachedPreviewMedia>();
const pendingPreviewMedia = new Map<string, Promise<string>>();
let cachedPreviewMediaCharacters = 0;

export function hasLocalHyperframesMedia(html: string): boolean {
	return html.includes("opencut-media://local/");
}

export function hyperframesPreviewSourceRevision(html: string): string {
	let hash = 2_166_136_261;
	for (let index = 0; index < html.length; index += 1) {
		hash ^= html.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return `${html.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export function selectHyperframesPreviewHtml({
	hasLocalMedia,
	basePreparedHtml,
	elementId,
	resolvedMedia,
}: {
	hasLocalMedia: boolean;
	basePreparedHtml: string;
	elementId: string;
	resolvedMedia: ResolvedHyperframesPreviewMedia | null;
}): string | null {
	if (!hasLocalMedia) return basePreparedHtml;
	if (resolvedMedia?.elementId !== elementId) return null;
	// Keep the last valid document visible while a new revision resolves. The
	// parent rejects its old-token messages until the replacement is ready.
	return resolvedMedia.html;
}

export function hyperframesPreviewMediaCacheKey({
	projectId,
	elementId,
	html,
}: {
	projectId: string;
	elementId: string;
	html: string;
}): string {
	return `${projectId}\u0000${elementId}\u0000${html}`;
}

function readCachedPreviewMedia(key: string): string | null {
	const cached = resolvedPreviewMedia.get(key);
	if (!cached) return null;
	resolvedPreviewMedia.delete(key);
	resolvedPreviewMedia.set(key, cached);
	return cached.html;
}

function cachePreviewMedia({ key, html }: { key: string; html: string }): void {
	const existing = resolvedPreviewMedia.get(key);
	if (existing) {
		cachedPreviewMediaCharacters -= existing.size;
		resolvedPreviewMedia.delete(key);
	}
	const cached = { html, size: html.length };
	resolvedPreviewMedia.set(key, cached);
	cachedPreviewMediaCharacters += cached.size;

	while (
		resolvedPreviewMedia.size > MAX_CACHED_PREVIEW_MEDIA_ENTRIES ||
		cachedPreviewMediaCharacters > MAX_CACHED_PREVIEW_MEDIA_CHARACTERS
	) {
		const oldestKey = resolvedPreviewMedia.keys().next().value;
		if (typeof oldestKey !== "string") break;
		const oldest = resolvedPreviewMedia.get(oldestKey);
		resolvedPreviewMedia.delete(oldestKey);
		cachedPreviewMediaCharacters -= oldest?.size ?? 0;
	}
}

export function resolveCachedHyperframesPreviewMedia({
	key,
	resolve,
}: {
	key: string;
	resolve: () => Promise<string>;
}): Promise<string> {
	const cached = readCachedPreviewMedia(key);
	if (cached !== null) return Promise.resolve(cached);

	const pending = pendingPreviewMedia.get(key);
	if (pending) return pending;

	const request = resolve()
		.then((html) => {
			cachePreviewMedia({ key, html });
			return html;
		})
		.finally(() => {
			if (pendingPreviewMedia.get(key) === request) {
				pendingPreviewMedia.delete(key);
			}
		});
	pendingPreviewMedia.set(key, request);
	return request;
}

export function clearHyperframesPreviewMediaCache(): void {
	resolvedPreviewMedia.clear();
	pendingPreviewMedia.clear();
	cachedPreviewMediaCharacters = 0;
}
