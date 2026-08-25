import type { EditorCore } from "@/core";
import type { StockCandidate } from "../types";

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

export interface AcquiredMedia {
	mediaId: string;
	candidate: StockCandidate;
}

function fileNameFor({ candidate }: { candidate: StockCandidate }): string {
	const extension = candidate.kind === "video" ? "mp4" : "jpg";
	const label = candidate.id.split(":").pop() ?? "asset";
	return `rhymx-${label}.${extension}`;
}

/**
 * Registers a stock candidate for timeline use.
 *
 * Videos are registered as remote streaming assets: zero disk usage, frames
 * decode on demand over HTTP range requests via mediabunny's UrlSource.
 * Images are small and need CORS-safe canvas access, so they are still
 * downloaded. Deduplicated by candidate id via the returned cache.
 */
export class MediaAcquirer {
	private acquired = new Map<string, AcquiredMedia>();

	getCached({ candidateId }: { candidateId: string }): AcquiredMedia | null {
		return this.acquired.get(candidateId) ?? null;
	}

	async acquire({
		editor,
		candidate,
		signal,
	}: {
		editor: EditorCore;
		candidate: StockCandidate;
		signal?: AbortSignal;
	}): Promise<AcquiredMedia> {
		const cached = this.getCached({ candidateId: candidate.id });
		if (cached) {
			return cached;
		}

		if (candidate.kind === "video") {
			const asset = await editor.media.addMediaAsset({
				projectId: editor.project.getActive().metadata.id,
				asset: {
					name: `${candidate.provider} · ${fileNameFor({ candidate })}`,
					type: "video",
					remoteUrl: candidate.sourceUrl,
					thumbnailUrl: candidate.thumbnailUrl,
					width: candidate.width,
					height: candidate.height,
					duration: candidate.durationSec,
				},
			});
			if (!asset) {
				throw new Error("Could not register the streaming clip");
			}
			const acquired: AcquiredMedia = { mediaId: asset.id, candidate };
			this.acquired.set(candidate.id, acquired);
			return acquired;
		}

		let response: Response;
		try {
			response = await fetch(candidate.sourceUrl, { signal });
		} catch (error) {
			if (error instanceof TypeError) {
				throw new Error(
					"Download blocked by CORS. Try a different result or provider.",
				);
			}
			throw error;
		}
		if (!response.ok) {
			throw new Error(`Download failed (${response.status})`);
		}
		const contentLength = Number(response.headers.get("content-length") ?? "0");
		if (contentLength > MAX_DOWNLOAD_BYTES) {
			throw new Error("File exceeds the 500 MB download limit");
		}

		const blob = await response.blob();
		const file = new File([blob], fileNameFor({ candidate }), {
			type: blob.type || "image/jpeg",
			lastModified: Date.now(),
		});

		const url = URL.createObjectURL(file);

		const asset = await editor.media.addMediaAsset({
			projectId: editor.project.getActive().metadata.id,
			asset: {
				name: `${candidate.provider} · ${fileNameFor({ candidate })}`,
				type: "image",
				file,
				url,
				thumbnailUrl: url,
				width: candidate.width,
				height: candidate.height,
			},
		});
		if (!asset) {
			URL.revokeObjectURL(url);
			throw new Error("Could not save downloaded media to the project");
		}

		const acquired: AcquiredMedia = { mediaId: asset.id, candidate };
		this.acquired.set(candidate.id, acquired);
		return acquired;
	}
}
