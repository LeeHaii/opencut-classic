import type { EditorCore } from "@/core";
import type { StockCandidate } from "../types";

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

export interface AcquiredMedia {
	mediaId: string;
	candidate: StockCandidate;
}

function fileNameFor({
	candidate,
}: {
	candidate: StockCandidate;
}): string {
	const extension = candidate.kind === "video" ? "mp4" : "jpg";
	const label = candidate.id.split(":").pop() ?? "asset";
	return `rhymx-${label}.${extension}`;
}

/**
 * Downloads a stock candidate into the project media library.
 * Deduplicated by candidate id via the returned cache.
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
			type: blob.type || (candidate.kind === "video" ? "video/mp4" : "image/jpeg"),
			lastModified: Date.now(),
		});

		const asset = await editor.media.addMediaAsset({
			projectId: editor.project.getActive().metadata.id,
			asset: {
				name: `${candidate.provider} · ${fileNameFor({ candidate })}`,
				type: candidate.kind === "video" ? "video" : "image",
				file,
				width: candidate.width,
				height: candidate.height,
				duration: candidate.durationSec,
				thumbnailUrl: URL.createObjectURL(blob),
			},
		});
		if (!asset) {
			throw new Error("Could not save downloaded media to the project");
		}

		const acquired: AcquiredMedia = { mediaId: asset.id, candidate };
		this.acquired.set(candidate.id, acquired);
		return acquired;
	}
}
