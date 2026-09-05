import type { MediaAssetData } from "@/services/storage/types";

export type MediaType = "image" | "video" | "audio";

export const ROOT_MEDIA_FOLDER_ID = "__root__";

export interface MediaFolder {
	id: string;
	parentId: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

export interface MediaAsset extends Omit<
	MediaAssetData,
	"size" | "lastModified"
> {
	/** Runtime-only state while a stock asset is being downloaded. */
	downloadStatus?: "pending" | "ready" | "failed";
	/**
	 * Local bytes for the asset. Absent for remote (streamed) assets that
	 * have not been downloaded for offline use yet.
	 */
	file?: File;
	url?: string;
	/**
	 * Remote media URL for assets streamed straight from their provider
	 * (HTTP range requests) without touching the disk.
	 */
	remoteUrl?: string;
}
