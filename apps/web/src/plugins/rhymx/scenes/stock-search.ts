import {
	isRecord,
	optionalNumber,
	optionalString,
	recordArray,
} from "../ai/json";
import type { StockCandidate, StockProviderId } from "../types";

export interface StockSearchQuery {
	query: string;
	providers: StockProviderId[];
	kind?: "video" | "image" | "all";
	orientation?: "landscape" | "portrait";
	page?: number;
}

export interface StockProviderContext {
	pexelsKey: string;
	pixabayKey: string;
	signal?: AbortSignal;
}

interface ProviderSearchArgs {
	query: string;
	page: number;
	context: StockProviderContext;
}

type ProviderSearch = (args: ProviderSearchArgs) => Promise<StockCandidate[]>;

const PEXELS_LICENSE = {
	licenseName: "Pexels License",
	licenseUrl: "https://www.pexels.com/license/",
};
const PIXABAY_LICENSE = {
	licenseName: "Pixabay Content License",
	licenseUrl: "https://pixabay.com/service/license-summary/",
};

async function fetchJson({
	url,
	init,
	fallbackError,
	signal,
}: {
	url: string;
	init?: RequestInit;
	fallbackError: string;
	signal?: AbortSignal;
}): Promise<unknown> {
	const response = await fetch(url, { ...init, signal });
	if (!response.ok) {
		throw new Error(`${fallbackError} (${response.status})`);
	}
	return response.json();
}

const pexelsVideos: ProviderSearch = async ({ query, page, context }) => {
	const data = await fetchJson({
		url: `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=8&page=${page}&orientation=landscape`,
		init: { headers: { Authorization: context.pexelsKey } },
		fallbackError: "Pexels error",
		signal: context.signal,
	});
	return recordArray(isRecord(data) ? data.videos : undefined).flatMap(
		(video) => {
			const files = recordArray(video.video_files)
				.filter((file) => file.file_type === "video/mp4")
				.sort(
					(a, b) =>
						(optionalNumber(b.width) ?? 0) - (optionalNumber(a.width) ?? 0),
				);
			const exportFile =
				files.find(
					(file) =>
						(optionalNumber(file.width) ?? 0) <= 1920 &&
						(optionalNumber(file.width) ?? 0) >= 1280,
				) ?? files[0];
			const previewFile =
				[...files]
					.reverse()
					.find((file) => (optionalNumber(file.width) ?? 0) >= 640) ??
				exportFile;
			const sourceUrl = optionalString(exportFile?.link);
			if (!sourceUrl) {
				return [];
			}
			const user = isRecord(video.user) ? video.user : null;
			const candidate: StockCandidate = {
				id: `pexels:${optionalNumber(video.id) ?? sourceUrl}`,
				provider: "pexels",
				kind: "video",
				sourceUrl,
				previewUrl: optionalString(previewFile?.link),
				thumbnailUrl: optionalString(video.image),
				width: optionalNumber(video.width),
				height: optionalNumber(video.height),
				durationSec: optionalNumber(video.duration),
				creator: user ? optionalString(user.name) : undefined,
				creatorUrl: user ? optionalString(user.url) : undefined,
				landingUrl: optionalString(video.url),
				...PEXELS_LICENSE,
			};
			return [candidate];
		},
	);
};

const pexelsImages: ProviderSearch = async ({ query, page, context }) => {
	const data = await fetchJson({
		url: `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=8&page=${page}&orientation=landscape`,
		init: { headers: { Authorization: context.pexelsKey } },
		fallbackError: "Pexels error",
		signal: context.signal,
	});
	return recordArray(isRecord(data) ? data.photos : undefined).flatMap(
		(photo) => {
			const src = isRecord(photo.src) ? photo.src : null;
			const sourceUrl = src ? optionalString(src.original) : undefined;
			if (!sourceUrl) {
				return [];
			}
			const candidate: StockCandidate = {
				id: `pexels-img:${optionalNumber(photo.id) ?? sourceUrl}`,
				provider: "pexels",
				kind: "image",
				sourceUrl,
				previewUrl: src ? optionalString(src.large) : undefined,
				thumbnailUrl: src
					? (optionalString(src.medium) ?? optionalString(src.small))
					: undefined,
				width: optionalNumber(photo.width),
				height: optionalNumber(photo.height),
				creator: optionalString(photo.photographer),
				creatorUrl: optionalString(photo.photographer_url),
				landingUrl: optionalString(photo.url),
				...PEXELS_LICENSE,
			};
			return [candidate];
		},
	);
};

async function pixabayRequest({
	endpoint,
	params,
	context,
}: {
	endpoint: string;
	params: string;
	context: StockProviderContext;
}): Promise<Record<string, unknown>[]> {
	const data = await fetchJson({
		url: `https://pixabay.com/api/${endpoint}?key=${encodeURIComponent(context.pixabayKey)}&${params}`,
		fallbackError: "Pixabay error",
		signal: context.signal,
	});
	return recordArray(isRecord(data) ? data.hits : undefined);
}

const pixabayVideos: ProviderSearch = async ({ query, page, context }) => {
	const hits = await pixabayRequest({
		endpoint: "videos",
		params: `q=${encodeURIComponent(query)}&per_page=8&page=${page}&safesearch=true`,
		context,
	});
	return hits.flatMap((hit) => {
		const videos = isRecord(hit.videos) ? hit.videos : null;
		if (!videos) {
			return [];
		}
		const variant = isRecord(videos.large)
			? videos.large
			: isRecord(videos.medium)
				? videos.medium
				: isRecord(videos.small)
					? videos.small
					: null;
		const sourceUrl = variant ? optionalString(variant.url) : undefined;
		if (!sourceUrl) {
			return [];
		}
		const candidate: StockCandidate = {
			id: `pixabay:${optionalNumber(hit.id) ?? sourceUrl}`,
			provider: "pixabay",
			kind: "video",
			sourceUrl,
			width: optionalNumber(hit.width),
			height: optionalNumber(hit.height),
			durationSec: optionalNumber(hit.duration),
			creator: optionalString(hit.user),
			landingUrl: optionalString(hit.pageURL),
			...PIXABAY_LICENSE,
		};
		return [candidate];
	});
};

const pixabayImages: ProviderSearch = async ({ query, page, context }) => {
	const hits = await pixabayRequest({
		endpoint: "",
		params: `q=${encodeURIComponent(query)}&per_page=8&page=${page}&safesearch=true&image_type=photo`,
		context,
	});
	return hits.flatMap((hit) => {
		const sourceUrl = optionalString(hit.largeImageURL);
		if (!sourceUrl) {
			return [];
		}
		const candidate: StockCandidate = {
			id: `pixabay-img:${optionalNumber(hit.id) ?? sourceUrl}`,
			provider: "pixabay",
			kind: "image",
			sourceUrl,
			previewUrl: optionalString(hit.webformatURL),
			thumbnailUrl: optionalString(hit.webformatURL),
			width: optionalNumber(hit.imageWidth),
			height: optionalNumber(hit.imageHeight),
			creator: optionalString(hit.user),
			landingUrl: optionalString(hit.pageURL),
			...PIXABAY_LICENSE,
		};
		return [candidate];
	});
};

const wikimediaImages: ProviderSearch = async ({ query, page, context }) => {
	const params = new URLSearchParams({
		action: "query",
		generator: "search",
		gsrsearch: `filetype:bitmap ${query}`,
		gsrlimit: "10",
		gsrnamespace: "6",
		gsroffset: String(Math.max(0, page - 1) * 10),
		prop: "imageinfo",
		iiprop: "url|extmetadata|size",
		iiurlwidth: "1280",
		format: "json",
		origin: "*",
	});
	const data = await fetchJson({
		url: `https://commons.wikimedia.org/w/api.php?${params.toString()}`,
		fallbackError: "Wikimedia error",
		signal: context.signal,
	});
	const queryRecord = isRecord(data) ? data.query : undefined;
	const pagesRecord =
		isRecord(queryRecord) && isRecord(queryRecord.pages)
			? queryRecord.pages
			: null;
	if (!pagesRecord) {
		return [];
	}
	return Object.values(pagesRecord).flatMap((value) => {
		const entry = isRecord(value) ? value : null;
		if (!entry) {
			return [];
		}
		const info = recordArray(entry.imageinfo)[0];
		const sourceUrl = info ? optionalString(info.url) : undefined;
		if (!info || !sourceUrl) {
			return [];
		}
		const metadata = isRecord(info.extmetadata) ? info.extmetadata : null;
		const rawLicense = metadata
			? optionalString(
					isRecord(metadata.LicenseShortName)
						? metadata.LicenseShortName.value
						: undefined,
				)
			: undefined;
		const licenseName = rawLicense
			? rawLicense.replace(/<[^>]*>/g, "")
			: "Wikimedia Commons (see file page)";
		const rawArtist = metadata
			? optionalString(
					isRecord(metadata.Artist) ? metadata.Artist.value : undefined,
				)
			: undefined;
		const candidate: StockCandidate = {
			id: `wikimedia:${encodeURIComponent(
				optionalString(entry.title) ?? sourceUrl,
			)}`,
			provider: "wikimedia",
			kind: "image",
			sourceUrl,
			previewUrl: optionalString(info.thumburl) ?? sourceUrl,
			thumbnailUrl: optionalString(info.thumburl) ?? sourceUrl,
			width: optionalNumber(info.width),
			height: optionalNumber(info.height),
			creator: rawArtist ? rawArtist.replace(/<[^>]*>/g, "") : undefined,
			landingUrl: optionalString(info.descriptionurl),
			licenseName,
		};
		return [candidate];
	});
};

const archiveVideos: ProviderSearch = async ({ query, page, context }) => {
	const params = new URLSearchParams({
		q: `${query} AND mediatype:(movies)`,
		fl: "identifier,title,creator,licenseurl",
		rows: "10",
		page: String(page),
		output: "json",
	});
	const data = await fetchJson({
		url: `https://archive.org/advancedsearch.php?${params.toString()}`,
		fallbackError: "Archive.org error",
		signal: context.signal,
	});
	const responseRecord = isRecord(data) ? data.response : undefined;
	return recordArray(
		isRecord(responseRecord) ? responseRecord.docs : undefined,
	).flatMap((doc) => {
		const identifier = optionalString(doc.identifier);
		if (!identifier) {
			return [];
		}
		const licenseUrl = optionalString(doc.licenseurl);
		const candidate: StockCandidate = {
			id: `archive:${identifier}`,
			provider: "archive",
			kind: "video",
			sourceUrl: `https://archive.org/details/${identifier}`,
			thumbnailUrl: `https://archive.org/services/img/${identifier}`,
			creator: optionalString(doc.creator),
			landingUrl: `https://archive.org/details/${identifier}`,
			licenseName: licenseUrl
				? licenseUrl.split("/").slice(3, 5).join(" ").replace("-", " ")
				: "Public domain (verify on item page)",
			licenseUrl,
		};
		return [candidate];
	});
};

const nasaImages: ProviderSearch = async ({ query, page, context }) => {
	const data = await fetchJson({
		url: `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image&page_size=10&page=${page}`,
		fallbackError: "NASA error",
		signal: context.signal,
	});
	const collection = isRecord(data) ? data.collection : undefined;
	return recordArray(isRecord(collection) ? collection.items : []).flatMap(
		(item) => {
			const meta = recordArray(item.data)[0];
			const nasaId = meta ? optionalString(meta.nasa_id) : undefined;
			const selfHref = typeof item.href === "string" ? item.href : null;
			if (!meta || !nasaId || !selfHref) {
				return [];
			}
			const thumbHref = optionalString(recordArray(item.links)[0]?.href);
			const candidate: StockCandidate = {
				id: `nasa:${nasaId}`,
				provider: "nasa",
				kind: "image",
				sourceUrl: selfHref,
				previewUrl: thumbHref,
				thumbnailUrl: thumbHref,
				creator: optionalString(meta.photographer) ?? "NASA",
				landingUrl: `https://images.nasa.gov/details/${nasaId}`,
				licenseName: "Public domain (NASA media usage guidelines)",
				licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
			};
			return [candidate];
		},
	);
};

const PROVIDER_SEARCHES: Partial<
	Record<StockProviderId, { video?: ProviderSearch; image?: ProviderSearch }>
> = {
	pexels: { video: pexelsVideos, image: pexelsImages },
	pixabay: { video: pixabayVideos, image: pixabayImages },
	wikimedia: { image: wikimediaImages },
	archive: { video: archiveVideos },
	nasa: { image: nasaImages },
};

/**
 * Searches every requested provider in parallel. Individual provider failures
 * degrade gracefully — they are logged and skipped.
 */
export async function searchStockMedia({
	query,
	context,
}: {
	query: StockSearchQuery;
	context: StockProviderContext;
}): Promise<{ candidates: StockCandidate[] }> {
	const kind = query.kind ?? "all";
	const page = Math.max(1, query.page ?? 1);

	const jobs: Array<Promise<StockCandidate[]>> = [];

	for (const provider of query.providers) {
		const entry = PROVIDER_SEARCHES[provider];
		if (!entry) {
			continue;
		}
		if (kind !== "image" && entry.video) {
			const search = entry.video;
			jobs.push(safeRun(() => search({ query: query.query, page, context })));
		}
		if (kind !== "video" && entry.image) {
			const search = entry.image;
			jobs.push(safeRun(() => search({ query: query.query, page, context })));
		}
	}

	const settled = await Promise.all(jobs);
	const candidates = settled
		.flat()
		.filter((candidate) => Boolean(candidate.sourceUrl));
	return { candidates };
}

async function safeRun(
	run: () => Promise<StockCandidate[]>,
): Promise<StockCandidate[]> {
	try {
		return await run();
	} catch (error) {
		console.warn(
			"[rhymx] provider search failed:",
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}
