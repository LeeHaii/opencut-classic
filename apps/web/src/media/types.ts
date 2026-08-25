import type { MediaAssetData } from "@/services/storage/types";

export type MediaType = "image" | "video" | "audio";

export interface MediaAsset extends Omit<
	MediaAssetData,
	"size" | "lastModified"
> {
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
