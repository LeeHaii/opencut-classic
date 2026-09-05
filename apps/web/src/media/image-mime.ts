import type { MediaType } from "@/media/types";

export const MAX_STUDIO_IMAGE_BYTES = 12 * 1024 * 1024;

export type StudioImageMimeType = "image/jpeg" | "image/png";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	m4a: "audio/mp4",
	ogg: "audio/ogg",
	png: "image/png",
	svg: "image/svg+xml",
	wav: "audio/wav",
	webm: "video/webm",
	webp: "image/webp",
};

function mimeTypeFromName({ name }: { name: string }): string {
	const extension = name.split(".").pop()?.toLowerCase();
	return extension ? (MIME_BY_EXTENSION[extension] ?? "") : "";
}

export async function sniffStudioImageMimeType({
	file,
}: {
	file: Blob;
}): Promise<StudioImageMimeType | null> {
	const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}
	return null;
}

export async function restorePersistedMediaFile({
	file,
	name,
	lastModified,
	mediaType,
	declaredMimeType,
}: {
	file: File;
	name: string;
	lastModified: number;
	mediaType: MediaType;
	declaredMimeType?: string;
}): Promise<File> {
	const sniffedMimeType =
		mediaType === "image" ? await sniffStudioImageMimeType({ file }) : null;
	const mimeType =
		sniffedMimeType ||
		declaredMimeType ||
		file.type ||
		mimeTypeFromName({ name });

	if (
		file.name === name &&
		file.type === mimeType &&
		file.lastModified === lastModified
	) {
		return file;
	}

	const typedBlob = new Blob([file.slice(0, file.size)], { type: mimeType });
	return new File([typedBlob], name, {
		type: mimeType,
		lastModified,
	});
}

async function readBlobAsDataUrl({
	blob,
	mimeType,
}: {
	blob: Blob;
	mimeType: StudioImageMimeType;
}): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const chunks: string[] = [];
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		chunks.push(
			String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
		);
	}
	return `data:${mimeType};base64,${btoa(chunks.join(""))}`;
}

export async function studioImageFileAsDataUrl({
	file,
}: {
	file: File;
}): Promise<string> {
	if (file.size > MAX_STUDIO_IMAGE_BYTES) {
		throw new Error("The dropped image exceeds the 12 MB size limit");
	}
	const mimeType = await sniffStudioImageMimeType({ file });
	if (!mimeType) {
		throw new Error(
			"Scene Studio replacement currently supports PNG and JPEG images",
		);
	}
	const typedBlob =
		file.type === mimeType ? file : new Blob([file], { type: mimeType });
	const dataUrl = await readBlobAsDataUrl({ blob: typedBlob, mimeType });
	if (!dataUrl.startsWith(`data:${mimeType};base64,`)) {
		throw new Error("Could not encode the dropped image");
	}
	return dataUrl;
}
