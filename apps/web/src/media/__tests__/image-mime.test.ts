import { describe, expect, it } from "bun:test";
import {
	restorePersistedMediaFile,
	sniffStudioImageMimeType,
	studioImageFileAsDataUrl,
} from "../image-mime";

const PNG_1X1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function bytesFromBase64({ value }: { value: string }): ArrayBuffer {
	const decoded = Uint8Array.from(atob(value), (character) =>
		character.charCodeAt(0),
	);
	const buffer = new ArrayBuffer(decoded.length);
	new Uint8Array(buffer).set(decoded);
	return buffer;
}

function pngFile({
	name = "asset-id",
	type = "",
}: {
	name?: string;
	type?: string;
} = {}): File {
	return new File([bytesFromBase64({ value: PNG_1X1 })], name, { type });
}

describe("persisted media MIME recovery", () => {
	it("sniffs an untyped OPFS PNG from its bytes", async () => {
		await expect(sniffStudioImageMimeType({ file: pngFile() })).resolves.toBe(
			"image/png",
		);
	});

	it("restores a valid MIME type and persisted timestamp", async () => {
		const restored = await restorePersistedMediaFile({
			file: pngFile(),
			name: "brand-mark.png",
			lastModified: 1234,
			mediaType: "image",
		});

		expect(restored.type).toBe("image/png");
		expect(restored.lastModified).toBe(1234);
	});

	it("encodes an untyped persisted image with an image data URL", async () => {
		const dataUrl = await studioImageFileAsDataUrl({ file: pngFile() });

		expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
	});

	it("rejects declared images whose bytes are not PNG or JPEG", async () => {
		const invalid = new File(["not an image"], "fake.png", {
			type: "image/png",
		});

		await expect(studioImageFileAsDataUrl({ file: invalid })).rejects.toThrow(
			"supports PNG and JPEG",
		);
	});
});
