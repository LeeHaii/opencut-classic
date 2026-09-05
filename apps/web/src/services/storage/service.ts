import type { TProject, TProjectMetadata } from "@/project/types";
import { getProjectDurationFromScenes } from "@/timeline/scenes";
import type { MediaAsset } from "@/media/types";
import { IndexedDBAdapter } from "./indexeddb-adapter";
import { OPFSAdapter } from "./opfs-adapter";
import {
	type StorageCapacityCheckResult,
	StorageQuotaExceededError,
	evaluateStorageCapacity,
	isStorageQuotaExceededError,
	readStorageQuotaStatus,
} from "./quota";
import type {
	MediaAssetData,
	MediaFolderData,
	StorageConfig,
	SerializedProject,
	SerializedScene,
} from "./types";
import type { SavedSoundsData, SavedSound, SoundEffect } from "@/sounds/types";
import {
	migrations,
	runStorageMigrations,
} from "@/services/storage/migrations";
import type { Bookmark, SceneTracks, TScene } from "@/timeline";
import { roundMediaTime } from "@/wasm";
import { restorePersistedMediaFile } from "@/media/image-mime";

interface ProjectMediaAdapters {
	mediaMetadataAdapter: IndexedDBAdapter<MediaAssetData>;
	mediaAssetsAdapter: OPFSAdapter;
	mediaFoldersAdapter: IndexedDBAdapter<MediaFolderData>;
}

function normalizeBookmarks({ raw }: { raw: unknown }): Bookmark[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item): Bookmark | null => {
			if (typeof item === "number") {
				return { time: roundMediaTime({ time: item }) };
			}
			if (
				typeof item !== "object" ||
				item === null ||
				!("time" in item) ||
				typeof item.time !== "number"
			) {
				return null;
			}
			return {
				time: roundMediaTime({ time: item.time }),
				...("note" in item &&
					typeof item.note === "string" && { note: item.note }),
				...("color" in item &&
					typeof item.color === "string" && { color: item.color }),
				...("duration" in item &&
					typeof item.duration === "number" && {
						duration: roundMediaTime({ time: item.duration }),
					}),
			};
		})
		.filter((b): b is Bookmark => b !== null);
}

function deserializeScene(scene: SerializedScene): TScene {
	return {
		...scene,
		bookmarks: normalizeBookmarks({ raw: scene.bookmarks }),
		createdAt: new Date(scene.createdAt),
		updatedAt: new Date(scene.updatedAt),
	};
}

class StorageService {
	private projectsAdapter: IndexedDBAdapter<SerializedProject>;
	private savedSoundsAdapter: IndexedDBAdapter<SavedSoundsData>;
	private config: StorageConfig;
	private migrationsPromise: Promise<void> | null = null;
	private projectMediaAdapters = new Map<string, ProjectMediaAdapters>();

	constructor() {
		this.config = {
			projectsDb: "video-editor-projects",
			mediaDb: "video-editor-media",
			savedSoundsDb: "video-editor-saved-sounds",
			version: 1,
		};

		this.projectsAdapter = new IndexedDBAdapter<SerializedProject>({
			dbName: this.config.projectsDb,
			storeName: "projects",
			version: this.config.version,
		});

		this.savedSoundsAdapter = new IndexedDBAdapter<SavedSoundsData>({
			dbName: this.config.savedSoundsDb,
			storeName: "saved-sounds",
			version: this.config.version,
		});
	}

	private async ensureMigrations(): Promise<void> {
		if (this.migrationsPromise) {
			await this.migrationsPromise;
			return;
		}

		this.migrationsPromise = runStorageMigrations({ migrations }).then(
			() => undefined,
		);
		await this.migrationsPromise;
	}

	private getProjectMediaAdapters({
		projectId,
	}: {
		projectId: string;
	}): ProjectMediaAdapters {
		const cached = this.projectMediaAdapters.get(projectId);
		if (cached) return cached;
		const mediaMetadataAdapter = new IndexedDBAdapter<MediaAssetData>({
			dbName: `${this.config.mediaDb}-${projectId}`,
			storeName: "media-metadata",
			version: this.config.version,
		});

		const mediaAssetsAdapter = new OPFSAdapter(`media-files-${projectId}`);
		const mediaFoldersAdapter = new IndexedDBAdapter<MediaFolderData>({
			dbName: `${this.config.mediaDb}-folders-${projectId}`,
			storeName: "media-folders",
			version: 1,
		});

		const adapters = {
			mediaMetadataAdapter,
			mediaAssetsAdapter,
			mediaFoldersAdapter,
		};
		this.projectMediaAdapters.set(projectId, adapters);
		return adapters;
	}

	private mediaMetadata(mediaAsset: MediaAsset): MediaAssetData {
		return {
			id: mediaAsset.id,
			name: mediaAsset.name,
			type: mediaAsset.type,
			mimeType: mediaAsset.file?.type || mediaAsset.mimeType,
			size: mediaAsset.file?.size ?? 0,
			lastModified: mediaAsset.file?.lastModified ?? Date.now(),
			width: mediaAsset.width,
			height: mediaAsset.height,
			duration: mediaAsset.duration,
			fps: mediaAsset.fps,
			hasAudio: mediaAsset.hasAudio,
			thumbnailUrl: mediaAsset.thumbnailUrl,
			ephemeral: mediaAsset.ephemeral,
			remoteUrl: mediaAsset.remoteUrl,
			folderId: mediaAsset.folderId,
		};
	}

	async canStoreFile({
		size,
	}: {
		size: number;
	}): Promise<StorageCapacityCheckResult> {
		const quotaStatus = await readStorageQuotaStatus();
		return evaluateStorageCapacity({
			requiredBytes: size,
			quotaStatus,
		});
	}

	isQuotaExceededError({ error }: { error: unknown }): boolean {
		return isStorageQuotaExceededError({ error });
	}

	private stripAudioBuffers({ tracks }: { tracks: SceneTracks }): SceneTracks {
		return {
			...tracks,
			audio: tracks.audio.map((track) => ({
				...track,
				elements: track.elements.map((element) => {
					const { buffer: _buffer, ...rest } = element;
					return rest;
				}),
			})),
		};
	}

	async saveProject({ project }: { project: TProject }): Promise<void> {
		const duration =
			project.metadata.duration ??
			getProjectDurationFromScenes({ scenes: project.scenes });
		const serializedScenes: SerializedScene[] = project.scenes.map((scene) => ({
			id: scene.id,
			name: scene.name,
			isMain: scene.isMain,
			tracks: this.stripAudioBuffers({ tracks: scene.tracks }),
			bookmarks: scene.bookmarks,
			createdAt: scene.createdAt.toISOString(),
			updatedAt: scene.updatedAt.toISOString(),
		}));

		const serializedProject: SerializedProject = {
			metadata: {
				id: project.metadata.id,
				name: project.metadata.name,
				thumbnail: project.metadata.thumbnail,
				duration,
				createdAt: project.metadata.createdAt.toISOString(),
				updatedAt: project.metadata.updatedAt.toISOString(),
			},
			scenes: serializedScenes,
			currentSceneId: project.currentSceneId,
			settings: project.settings,
			version: project.version,
			timelineViewState: project.timelineViewState,
		};

		await this.projectsAdapter.set({
			key: project.metadata.id,
			value: serializedProject,
		});
	}

	async loadProject({
		id,
	}: {
		id: string;
	}): Promise<{ project: TProject } | null> {
		await this.ensureMigrations();
		const serializedProject = await this.projectsAdapter.get(id);

		if (!serializedProject) return null;

		if (
			typeof serializedProject !== "object" ||
			serializedProject === null ||
			typeof serializedProject.metadata !== "object" ||
			serializedProject.metadata === null
		) {
			console.warn(
				"[storage] Skipping malformed project entry (missing metadata):",
				{ id, entry: serializedProject },
			);
			return null;
		}

		const scenes = serializedProject.scenes?.map(deserializeScene) ?? [];

		const project: TProject = {
			metadata: {
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({ scenes }),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			},
			scenes,
			currentSceneId: serializedProject.currentSceneId || "",
			settings: serializedProject.settings,
			version: serializedProject.version,
			timelineViewState: serializedProject.timelineViewState,
		};

		return { project };
	}

	async loadAllProjects(): Promise<TProject[]> {
		const projectIds = await this.projectsAdapter.list();
		const projects: TProject[] = [];

		for (const id of projectIds) {
			const result = await this.loadProject({ id });
			if (result?.project) {
				projects.push(result.project);
			}
		}

		return projects.sort(
			(a, b) => b.metadata.updatedAt.getTime() - a.metadata.updatedAt.getTime(),
		);
	}

	async loadAllProjectsMetadata(): Promise<TProjectMetadata[]> {
		await this.ensureMigrations();
		const serializedProjects = await this.projectsAdapter.getAll();

		const metadata: TProjectMetadata[] = [];
		for (const serializedProject of serializedProjects) {
			if (
				typeof serializedProject !== "object" ||
				serializedProject === null ||
				typeof serializedProject.metadata !== "object" ||
				serializedProject.metadata === null
			) {
				console.warn(
					"[storage] Skipping malformed project entry (missing metadata):",
					serializedProject,
				);
				continue;
			}

			metadata.push({
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({
							scenes: (serializedProject.scenes ?? []).map(deserializeScene),
						}),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			});
		}

		return metadata.sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
	}

	async deleteProject({ id }: { id: string }): Promise<void> {
		await this.projectsAdapter.remove(id);
	}

	async saveMediaAsset({
		projectId,
		mediaAsset,
	}: {
		projectId: string;
		mediaAsset: MediaAsset;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const metadata = this.mediaMetadata(mediaAsset);

		try {
			// Remote (streamed) assets have no local bytes to persist yet.
			if (mediaAsset.file) {
				await mediaAssetsAdapter.set({
					key: mediaAsset.id,
					value: mediaAsset.file,
				});
			}
			await mediaMetadataAdapter.set({
				key: mediaAsset.id,
				value: metadata,
			});
		} catch (error) {
			try {
				await mediaAssetsAdapter.remove(mediaAsset.id);
			} catch {
				// Ignore cleanup failures so the original storage error is preserved.
			}

			if (this.isQuotaExceededError({ error })) {
				throw new StorageQuotaExceededError({
					requiredBytes: mediaAsset.file?.size ?? 0,
				});
			}

			throw error;
		}
	}

	async loadMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<MediaAsset | null> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const [file, metadata] = await Promise.all([
			mediaAssetsAdapter.get(id),
			mediaMetadataAdapter.get(id),
		]);

		if (!metadata) return null;
		const asset = await this.materializeMediaAsset({ metadata, file });
		if (asset?.mimeType && asset.mimeType !== metadata.mimeType) {
			await mediaMetadataAdapter.set({
				key: asset.id,
				value: this.mediaMetadata(asset),
			});
		}
		return asset;
	}

	private async materializeMediaAsset({
		metadata,
		file,
	}: {
		metadata: MediaAssetData;
		file: File | null;
	}): Promise<MediaAsset | null> {
		if (!file) {
			// Remote (streamed) asset: no local bytes stored.
			if (!metadata.remoteUrl) return null;
			return {
				id: metadata.id,
				name: metadata.name,
				type: metadata.type,
				mimeType: metadata.mimeType,
				width: metadata.width,
				height: metadata.height,
				duration: metadata.duration,
				fps: metadata.fps,
				hasAudio: metadata.hasAudio,
				thumbnailUrl: metadata.thumbnailUrl,
				ephemeral: metadata.ephemeral,
				remoteUrl: metadata.remoteUrl,
				folderId: metadata.folderId,
			};
		}

		const restoredFile = await restorePersistedMediaFile({
			file,
			name: metadata.name,
			lastModified: metadata.lastModified,
			mediaType: metadata.type,
			declaredMimeType: metadata.mimeType,
		});
		let url: string;
		if (
			metadata.type === "image" &&
			(!restoredFile.type || restoredFile.type === "")
		) {
			try {
				const text = await restoredFile.text();
				if (text.trim().startsWith("<svg")) {
					const svgBlob = new Blob([text], { type: "image/svg+xml" });
					url = URL.createObjectURL(svgBlob);
				} else {
					url = URL.createObjectURL(restoredFile);
				}
			} catch {
				url = URL.createObjectURL(restoredFile);
			}
		} else {
			url = URL.createObjectURL(restoredFile);
		}

		return {
			id: metadata.id,
			name: metadata.name,
			type: metadata.type,
			mimeType: restoredFile.type || metadata.mimeType,
			file: restoredFile,
			url,
			width: metadata.width,
			height: metadata.height,
			duration: metadata.duration,
			fps: metadata.fps,
			hasAudio: metadata.hasAudio,
			thumbnailUrl: metadata.thumbnailUrl,
			ephemeral: metadata.ephemeral,
			remoteUrl: metadata.remoteUrl,
			folderId: metadata.folderId,
		};
	}

	async saveMediaFolders({
		projectId,
		folders,
	}: {
		projectId: string;
		folders: MediaFolderData[];
	}): Promise<void> {
		const { mediaFoldersAdapter } = this.getProjectMediaAdapters({ projectId });
		await mediaFoldersAdapter.setMany(
			folders.map((folder) => ({ key: folder.id, value: folder })),
		);
	}

	async loadMediaFolders({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaFolderData[]> {
		const { mediaFoldersAdapter } = this.getProjectMediaAdapters({ projectId });
		return mediaFoldersAdapter.getAll();
	}

	async deleteMediaFolders({
		projectId,
		folderIds,
	}: {
		projectId: string;
		folderIds: string[];
	}): Promise<void> {
		const { mediaFoldersAdapter } = this.getProjectMediaAdapters({ projectId });
		await Promise.all(folderIds.map((id) => mediaFoldersAdapter.remove(id)));
	}

	async updateMediaAssetFolders({
		projectId,
		assets,
	}: {
		projectId: string;
		assets: MediaAsset[];
	}): Promise<void> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});
		await mediaMetadataAdapter.setMany(
			assets.map((asset) => ({
				key: asset.id,
				value: this.mediaMetadata(asset),
			})),
		);
	}

	async loadAllMediaAssets({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaAsset[]> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({
				projectId,
			});
		const metadataItems = await mediaMetadataAdapter.getAll();
		const mediaItems: Array<MediaAsset | null> = Array.from(
			{
				length: metadataItems.length,
			},
			() => null,
		);
		let cursor = 0;
		const workerCount = Math.min(8, metadataItems.length);
		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (cursor < metadataItems.length) {
					const index = cursor++;
					const metadata = metadataItems[index];
					const file = await mediaAssetsAdapter.get(metadata.id);
					mediaItems[index] = await this.materializeMediaAsset({
						metadata,
						file,
					});
				}
			}),
		);

		const loadedItems = mediaItems.filter(
			(item): item is MediaAsset => item != null,
		);
		const metadataById = new Map(
			metadataItems.map((metadata) => [metadata.id, metadata]),
		);
		const repairedItems = loadedItems.filter((item) => {
			const metadata = metadataById.get(item.id);
			return item.mimeType && item.mimeType !== metadata?.mimeType;
		});
		if (repairedItems.length > 0) {
			await mediaMetadataAdapter.setMany(
				repairedItems.map((item) => ({
					key: item.id,
					value: this.mediaMetadata(item),
				})),
			);
		}

		return loadedItems;
	}

	async deleteMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		await Promise.all([
			mediaAssetsAdapter.remove(id),
			mediaMetadataAdapter.remove(id),
		]);
	}

	async deleteProjectMedia({
		projectId,
	}: {
		projectId: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter, mediaFoldersAdapter } =
			this.getProjectMediaAdapters({ projectId });

		await Promise.all([
			mediaMetadataAdapter.clear(),
			mediaAssetsAdapter.clear(),
			mediaFoldersAdapter.clear(),
		]);
	}

	async clearAllData(): Promise<void> {
		await this.projectsAdapter.clear();
		// project-specific media and timelines cleaned up when projects are deleted
	}

	async getStorageInfo(): Promise<{
		projects: number;
		isOPFSSupported: boolean;
		isIndexedDBSupported: boolean;
	}> {
		const projectIds = await this.projectsAdapter.list();

		return {
			projects: projectIds.length,
			isOPFSSupported: this.isOPFSSupported(),
			isIndexedDBSupported: this.isIndexedDBSupported(),
		};
	}

	async getProjectStorageInfo({ projectId }: { projectId: string }): Promise<{
		mediaItems: number;
	}> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();

		return {
			mediaItems: mediaIds.length,
		};
	}

	async loadSavedSounds(): Promise<SavedSoundsData> {
		try {
			const savedSoundsData = await this.savedSoundsAdapter.get("user-sounds");
			return (
				savedSoundsData || {
					sounds: [],
					lastModified: new Date().toISOString(),
				}
			);
		} catch (error) {
			console.error("Failed to load saved sounds:", error);
			return { sounds: [], lastModified: new Date().toISOString() };
		}
	}

	async saveSoundEffect({
		soundEffect,
	}: {
		soundEffect: SoundEffect;
	}): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			if (currentData.sounds.some((sound) => sound.id === soundEffect.id)) {
				return; // Already saved
			}

			const savedSound: SavedSound = {
				id: soundEffect.id,
				name: soundEffect.name,
				username: soundEffect.username,
				previewUrl: soundEffect.previewUrl,
				downloadUrl: soundEffect.downloadUrl,
				duration: soundEffect.duration,
				tags: soundEffect.tags,
				license: soundEffect.license,
				savedAt: new Date().toISOString(),
			};

			const updatedData: SavedSoundsData = {
				sounds: [...currentData.sounds, savedSound],
				lastModified: new Date().toISOString(),
			};

			await this.savedSoundsAdapter.set({
				key: "user-sounds",
				value: updatedData,
			});
		} catch (error) {
			console.error("Failed to save sound effect:", error);
			throw error;
		}
	}

	async removeSavedSound({ soundId }: { soundId: number }): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			const updatedData: SavedSoundsData = {
				sounds: currentData.sounds.filter((sound) => sound.id !== soundId),
				lastModified: new Date().toISOString(),
			};

			await this.savedSoundsAdapter.set({
				key: "user-sounds",
				value: updatedData,
			});
		} catch (error) {
			console.error("Failed to remove saved sound:", error);
			throw error;
		}
	}

	async isSoundSaved({ soundId }: { soundId: number }): Promise<boolean> {
		try {
			const currentData = await this.loadSavedSounds();
			return currentData.sounds.some((sound) => sound.id === soundId);
		} catch (error) {
			console.error("Failed to check if sound is saved:", error);
			return false;
		}
	}

	async clearSavedSounds(): Promise<void> {
		try {
			await this.savedSoundsAdapter.remove("user-sounds");
		} catch (error) {
			console.error("Failed to clear saved sounds:", error);
			throw error;
		}
	}

	isOPFSSupported(): boolean {
		return OPFSAdapter.isSupported();
	}

	isIndexedDBSupported(): boolean {
		return "indexedDB" in window;
	}

	isFullySupported(): boolean {
		return this.isIndexedDBSupported() && this.isOPFSSupported();
	}
}

export const storageService = new StorageService();
export { StorageService };
