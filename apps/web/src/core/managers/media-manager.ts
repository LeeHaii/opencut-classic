import type { EditorCore } from "@/core";
import { toast } from "sonner";
import {
	ROOT_MEDIA_FOLDER_ID,
	type MediaAsset,
	type MediaFolder,
} from "@/media/types";
import { storageService } from "@/services/storage/service";
import { generateUUID } from "@/utils/id";
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { BatchCommand, RemoveMediaAssetCommand } from "@/commands";

export class MediaManager {
	private assets: MediaAsset[] = [];
	private folders: MediaFolder[] = [];
	private assetsById = new Map<string, MediaAsset>();
	private assetIdsByFolder = new Map<string, string[]>();
	private foldersById = new Map<string, MediaFolder>();
	private folderIdsByParent = new Map<string, string[]>();
	private catalogWrites = new Map<string, Promise<void>>();
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
				item.id === id ? { ...pendingAsset, downloadStatus: "failed" } : item,
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
			const [mediaAssets, folders] = await Promise.all([
				storageService.loadAllMediaAssets({ projectId }),
				storageService.loadMediaFolders({ projectId }),
			]);
			this.assets = mediaAssets;
			this.folders = folders;
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
		const folderIds = this.folders.map((folder) => folder.id);
		this.assets = [];
		this.folders = [];
		this.notify();

		try {
			await Promise.all([
				...mediaIds.map((id) =>
					storageService.deleteMediaAsset({ projectId, id }),
				),
				storageService.deleteMediaFolders({
					projectId,
					folderIds,
				}),
			]);
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
		this.folders = [];
		this.notify();
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	getAsset({ id }: { id: string }): MediaAsset | null {
		return this.assetsById.get(id) ?? null;
	}

	getFolders(): MediaFolder[] {
		return this.folders;
	}

	getFolder({ id }: { id: string }): MediaFolder | null {
		return this.foldersById.get(id) ?? null;
	}

	getAssetsInFolder({ folderId }: { folderId: string }): MediaAsset[] {
		return (this.assetIdsByFolder.get(folderId) ?? [])
			.map((id) => this.assetsById.get(id))
			.filter((asset): asset is MediaAsset => asset != null);
	}

	getChildFolders({ parentId }: { parentId: string }): MediaFolder[] {
		return (this.folderIdsByParent.get(parentId) ?? [])
			.map((id) => this.foldersById.get(id))
			.filter((folder): folder is MediaFolder => folder != null);
	}

	createFolder({
		projectId,
		parentId,
		name,
	}: {
		projectId: string;
		parentId: string;
		name: string;
	}): MediaFolder {
		const now = Date.now();
		const folder: MediaFolder = {
			id: generateUUID(),
			parentId,
			name: name.trim(),
			createdAt: now,
			updatedAt: now,
		};
		this.addFolder({ projectId, folder });
		return folder;
	}

	addFolder({
		projectId,
		folder,
	}: {
		projectId: string;
		folder: MediaFolder;
	}): void {
		if (
			this.foldersById.has(folder.id) ||
			(folder.parentId !== ROOT_MEDIA_FOLDER_ID &&
				!this.foldersById.has(folder.parentId))
		) {
			return;
		}
		this.folders = [...this.folders, folder];
		this.notify();
		this.enqueueCatalogWrite({
			projectId,
			write: () =>
				storageService.saveMediaFolders({ projectId, folders: [folder] }),
			onError: (error) => {
				this.folders = this.folders.filter((item) => item.id !== folder.id);
				this.notify();
				toast.error("Could not create media folder", {
					description: error instanceof Error ? error.message : String(error),
				});
			},
		});
	}

	renameFolder({
		projectId,
		folderId,
		name,
	}: {
		projectId: string;
		folderId: string;
		name: string;
	}): void {
		const previous = this.folders.find((folder) => folder.id === folderId);
		if (!previous) return;
		const updated = { ...previous, name: name.trim(), updatedAt: Date.now() };
		this.folders = this.folders.map((folder) =>
			folder.id === folderId ? updated : folder,
		);
		this.notify();
		this.enqueueCatalogWrite({
			projectId,
			write: () =>
				storageService.saveMediaFolders({ projectId, folders: [updated] }),
			onError: (error) => {
				this.folders = this.folders.map((folder) =>
					folder.id === folderId && folder.name === updated.name
						? previous
						: folder,
				);
				this.notify();
				toast.error("Could not rename media folder", {
					description: error instanceof Error ? error.message : String(error),
				});
			},
		});
	}

	deleteFolder({
		projectId,
		folderId,
	}: {
		projectId: string;
		folderId: string;
	}): boolean {
		if (
			this.folders.some((folder) => folder.parentId === folderId) ||
			this.assets.some(
				(asset) => (asset.folderId ?? ROOT_MEDIA_FOLDER_ID) === folderId,
			)
		) {
			return false;
		}
		const removed = this.foldersById.get(folderId);
		this.folders = this.folders.filter((folder) => folder.id !== folderId);
		this.notify();
		this.enqueueCatalogWrite({
			projectId,
			write: () =>
				storageService.deleteMediaFolders({ projectId, folderIds: [folderId] }),
			onError: (error) => {
				if (removed && !this.foldersById.has(removed.id)) {
					this.folders = [...this.folders, removed];
					this.notify();
				}
				toast.error("Could not delete media folder", {
					description: error instanceof Error ? error.message : String(error),
				});
			},
		});
		return true;
	}

	moveFolder({
		projectId,
		folderId,
		parentId,
	}: {
		projectId: string;
		folderId: string;
		parentId: string;
	}): boolean {
		const previous = this.foldersById.get(folderId);
		if (
			!previous ||
			folderId === parentId ||
			previous.parentId === parentId ||
			(parentId !== ROOT_MEDIA_FOLDER_ID && !this.foldersById.has(parentId))
		) {
			return false;
		}
		let cursor = parentId;
		const visited = new Set<string>();
		while (cursor !== ROOT_MEDIA_FOLDER_ID && !visited.has(cursor)) {
			if (cursor === folderId) return false;
			visited.add(cursor);
			cursor = this.foldersById.get(cursor)?.parentId ?? ROOT_MEDIA_FOLDER_ID;
		}
		const updated = { ...previous, parentId, updatedAt: Date.now() };
		this.folders = this.folders.map((folder) =>
			folder.id === folderId ? updated : folder,
		);
		this.notify();
		this.enqueueCatalogWrite({
			projectId,
			write: () =>
				storageService.saveMediaFolders({ projectId, folders: [updated] }),
			onError: (error) => {
				this.folders = this.folders.map((folder) =>
					folder.id === folderId && folder.parentId === parentId
						? previous
						: folder,
				);
				this.notify();
				toast.error("Could not move media folder", {
					description: error instanceof Error ? error.message : String(error),
				});
			},
		});
		return true;
	}

	moveAssetsToFolder({
		projectId,
		assetIds,
		folderId,
	}: {
		projectId: string;
		assetIds: string[];
		folderId: string;
	}): void {
		if (folderId !== ROOT_MEDIA_FOLDER_ID && !this.foldersById.has(folderId)) {
			return;
		}
		const ids = new Set(assetIds);
		const changed: MediaAsset[] = [];
		const previous = new Map<string, MediaAsset>();
		this.assets = this.assets.map((asset) => {
			if (!ids.has(asset.id)) return asset;
			previous.set(asset.id, asset);
			const updated = { ...asset, folderId };
			changed.push(updated);
			return updated;
		});
		if (changed.length === 0) return;
		this.notify();
		this.enqueueCatalogWrite({
			projectId,
			write: () =>
				storageService.updateMediaAssetFolders({ projectId, assets: changed }),
			onError: (error) => {
				this.assets = this.assets.map((asset) => {
					const original = previous.get(asset.id);
					return original && asset.folderId === folderId ? original : asset;
				});
				this.notify();
				toast.error("Could not move media", {
					description: error instanceof Error ? error.message : String(error),
				});
			},
		});
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
		this.rebuildIndexes();
		this.listeners.forEach((fn) => {
			fn();
		});
	}

	private rebuildIndexes(): void {
		this.assetsById = new Map();
		this.assetIdsByFolder = new Map();
		for (const asset of this.assets) {
			this.assetsById.set(asset.id, asset);
			const folderId = asset.folderId ?? ROOT_MEDIA_FOLDER_ID;
			const bucket = this.assetIdsByFolder.get(folderId) ?? [];
			bucket.push(asset.id);
			this.assetIdsByFolder.set(folderId, bucket);
		}
		this.foldersById = new Map();
		this.folderIdsByParent = new Map();
		for (const folder of this.folders) {
			this.foldersById.set(folder.id, folder);
			const bucket = this.folderIdsByParent.get(folder.parentId) ?? [];
			bucket.push(folder.id);
			this.folderIdsByParent.set(folder.parentId, bucket);
		}
	}

	private enqueueCatalogWrite({
		projectId,
		write,
		onError,
	}: {
		projectId: string;
		write: () => Promise<void>;
		onError: (error: unknown) => void;
	}): void {
		const previous = this.catalogWrites.get(projectId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(write)
			.catch(onError)
			.finally(() => {
				if (this.catalogWrites.get(projectId) === next) {
					this.catalogWrites.delete(projectId);
				}
			});
		this.catalogWrites.set(projectId, next);
	}
}
