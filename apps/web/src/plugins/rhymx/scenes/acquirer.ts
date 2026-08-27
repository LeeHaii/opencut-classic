import type { EditorCore } from "@/core";
import type { StockCandidate } from "../types";

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

export interface AcquiredMedia {
	mediaId: string;
	candidate: StockCandidate;
}

export interface StartedMediaAcquisition {
	mediaId: string;
	acquisition: Promise<AcquiredMedia>;
}

function fileNameFor({ candidate }: { candidate: StockCandidate }): string {
	const extension = candidate.kind === "video" ? "mp4" : "jpg";
	const label = candidate.id.split(":").pop() ?? "asset";
	return `rhymx-${label}.${extension}`;
}

/** Downloads a stock candidate into the project media library on demand. */
export class MediaAcquirer {
	private acquired = new Map<string, AcquiredMedia>();
	private acquiring = new Map<string, StartedMediaAcquisition>();

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
		return this.startAcquisition({ editor, candidate, signal }).acquisition;
	}

	startAcquisition({
		editor,
		candidate,
		signal,
	}: {
		editor: EditorCore;
		candidate: StockCandidate;
		signal?: AbortSignal;
	}): StartedMediaAcquisition {
		const cached = this.getCached({ candidateId: candidate.id });
		if (cached) {
			return { mediaId: cached.mediaId, acquisition: Promise.resolve(cached) };
		}
		const pending = this.acquiring.get(candidate.id);
		if (pending) {
			return pending;
		}

		const pendingAsset = editor.media.addPendingMediaAsset({
			asset: {
				name: `${candidate.provider} · ${fileNameFor({ candidate })}`,
				type: candidate.kind,
				thumbnailUrl:
					candidate.thumbnailUrl ??
					(candidate.kind === "image" ? candidate.previewUrl : undefined),
				width: candidate.width,
				height: candidate.height,
				duration: candidate.durationSec,
			},
		});
		const started: StartedMediaAcquisition = {
			mediaId: pendingAsset.id,
			acquisition: Promise.resolve({
				mediaId: pendingAsset.id,
				candidate,
			}),
		};
		started.acquisition = this.download({
			editor,
			candidate,
			mediaId: pendingAsset.id,
			signal,
		})
			.catch((error: unknown) => {
				editor.media.markMediaAssetDownloadFailed({ id: pendingAsset.id });
				throw error;
			})
			.finally(() => {
				this.acquiring.delete(candidate.id);
			});
		this.acquiring.set(candidate.id, started);
		return started;
	}

	private async download({
		editor,
		candidate,
		mediaId,
		signal,
	}: {
		editor: EditorCore;
		candidate: StockCandidate;
		mediaId: string;
		signal?: AbortSignal;
	}): Promise<AcquiredMedia> {
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
		if (blob.size > MAX_DOWNLOAD_BYTES) {
			throw new Error("File exceeds the 500 MB download limit");
		}
		const file = new File([blob], fileNameFor({ candidate }), {
			type:
				blob.type || (candidate.kind === "video" ? "video/mp4" : "image/jpeg"),
			lastModified: Date.now(),
		});

		const url = URL.createObjectURL(file);

		const asset = await editor.media.finalizePendingMediaAsset({
			projectId: editor.project.getActive().metadata.id,
			id: mediaId,
			asset: {
				name: `${candidate.provider} · ${fileNameFor({ candidate })}`,
				type: candidate.kind,
				file,
				url,
				thumbnailUrl:
					candidate.thumbnailUrl ??
					(candidate.kind === "image" ? url : undefined),
				width: candidate.width,
				height: candidate.height,
				duration: candidate.durationSec,
			},
		});
		if (!asset) {
			URL.revokeObjectURL(url);
			throw new Error("Could not save downloaded media to the project");
		}

		const acquired: AcquiredMedia = { mediaId, candidate };
		this.acquired.set(candidate.id, acquired);
		return acquired;
	}
}
