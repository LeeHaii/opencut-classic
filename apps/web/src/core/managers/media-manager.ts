import type { EditorCore } from "@/core";
import { toast } from "sonner";
import type { MediaAsset } from "@/media/types";
import { storageService } from "@/services/storage/service";
import { generateUUID } from "@/utils/id";
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { BatchCommand, RemoveMediaAssetCommand } from "@/commands";

export class MediaManager {
	private assets: MediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	addPendingMediaAsset({
		asset,
	}: {
		asset: Omit<MediaAsset, "id" | "downloadStatus">;
	}): MediaAsset {
		const pendingAsset: MediaAsset = {
			...asset,
			id: generateUUID(),
			downloadStatus: "pending",
		};
		this.assets = [...this.assets, pendingAsset];
		this.notify();
		return pendingAsset;
	}

	async finalizePendingMediaAsset({
		projectId,
		id,
		asset,
	}: {
		projectId: string;
		id: string;
		asset: Omit<MediaAsset, "id" | "downloadStatus">;
	}): Promise<MediaAsset | null> {
		const pendingAsset = this.assets.find((item) => item.id === id);
		if (!pendingAsset) return null;

		const readyAsset: MediaAsset = {
			...asset,
			id,
			downloadStatus: "ready",
		};
		this.assets = this.assets.map((item) =>
			item.id === id ? readyAsset : item,
		);
		this.notify();

		try {
			await storageService.saveMediaAsset({
				projectId,
				mediaAsset: readyAsset,
			});
			this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [readyAsset],
			});
			return readyAsset;
		} catch (error) {
			console.error("Failed to save downloaded media asset:", error);
			this.assets = this.assets.map((item) =>
				item.id === id
					? { ...pendingAsset, downloadStatus: "failed" }
					: item,
			);
			this.notify();

			if (storageService.isQuotaExceededError({ error })) {
				toast.error("Not enough browser storage", {
					description: error instanceof Error ? error.message : undefined,
				});
			}

			return null;
		}
	}

	markMediaAssetDownloadFailed({ id }: { id: string }): void {
		this.assets = this.assets.map((asset) =>
			asset.id === id ? { ...asset, downloadStatus: "failed" } : asset,
		);
		this.notify();
	}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id">;
	}): Promise<MediaAsset | null> {
		const newAsset: MediaAsset = {
			...asset,
			id: generateUUID(),
		};

		this.assets = [...this.assets, newAsset];
		this.notify();

		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: newAsset });
			this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [newAsset],
			});
			return newAsset;
		} catch (error) {
			console.error("Failed to save media asset:", error);
			this.assets = this.assets.filter((asset) => asset.id !== newAsset.id);
			this.notify();

			if (storageService.isQuotaExceededError({ error })) {
				toast.error("Not enough browser storage", {
					description: error instanceof Error ? error.message : undefined,
				});
			}

			return null;
		}
	}

	removeMediaAsset({ projectId, id }: { projectId: string; id: string }): void {
		this.removeMediaAssets({ projectId, ids: [id] });
	}

	removeMediaAssets({
		projectId,
		ids,
	}: {
		projectId: string;
		ids: string[];
	}): void {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) {
			return;
		}

		const command =
			uniqueIds.length === 1
				? new RemoveMediaAssetCommand({
						projectId,
						assetId: uniqueIds[0],
					})
				: new BatchCommand(
						uniqueIds.map(
							(id) =>
								new RemoveMediaAssetCommand({
									projectId,
									assetId: id,
								}),
						),
					);

		this.editor.command.execute({ command });
	}

	async loadProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.isLoading = true;
		this.notify();

		try {
			const mediaAssets = await storageService.loadAllMediaAssets({
				projectId,
			});
			this.assets = mediaAssets;
			this.notify();
		} catch (error) {
			console.error("Failed to load media assets:", error);
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	/**
	 * Downloads a remote (streamed) asset's bytes to the project so it no
	 * longer depends on the network. The in-memory asset is replaced and
	 * persisted; the decoder cache is reset so playback re-inits locally.
	 */
	async downloadRemoteAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<MediaAsset | null> {
		const asset = this.assets.find((item) => item.id === id);
		if (!asset) return null;
		if (!asset.remoteUrl || asset.file) return asset;

		const response = await fetch(asset.remoteUrl);
		if (!response.ok) {
			throw new Error(`Download failed (${response.status})`);
		}
		const blob = await response.blob();
		const file = new File([blob], asset.name, {
			type: blob.type || "video/mp4",
			lastModified: Date.now(),
		});
		const objectUrl = URL.createObjectURL(file);

		const updated: MediaAsset = {
			...asset,
			file,
			url: objectUrl,
		};
		this.assets = this.assets.map((item) => (item.id === id ? updated : item));
		this.notify();

		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: updated });
			videoCache.clearVideo({ mediaId: id });
			return updated;
		} catch (error) {
			URL.revokeObjectURL(objectUrl);
			this.assets = this.assets.map((item) => (item.id === id ? asset : item));
			this.notify();
			throw error;
		}
	}

	async clearProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		const mediaIds = this.assets.map((asset) => asset.id);
		this.assets = [];
		this.notify();

		try {
			await Promise.all(
				mediaIds.map((id) =>
					storageService.deleteMediaAsset({ projectId, id }),
				),
			);
		} catch (error) {
			console.error("Failed to clear media assets from storage:", error);
		}
	}

	clearAllAssets(): void {
		videoCache.clearAll();
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		this.assets = [];
		this.notify();
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets;
		this.notify();
	}

	isLoadingMedia(): boolean {
		return this.isLoading;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
