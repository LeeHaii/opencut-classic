import { describe, expect, test } from "bun:test";
import {
	clearHyperframesPreviewMediaCache,
	hasLocalHyperframesMedia,
	hyperframesPreviewMediaCacheKey,
	hyperframesPreviewSourceRevision,
	resolveCachedHyperframesPreviewMedia,
	selectHyperframesPreviewHtml,
} from "../preview-media";

describe("Hyperframes preview media", () => {
	test("recognizes local media and fingerprints source revisions", () => {
		expect(
			hasLocalHyperframesMedia(
				'<img src="opencut-media://local/C%3A%5Cimage.png">',
			),
		).toBe(true);
		expect(
			hasLocalHyperframesMedia('<img src="data:image/png;base64,x">'),
		).toBe(false);
		expect(hyperframesPreviewSourceRevision("first")).not.toBe(
			hyperframesPreviewSourceRevision("second"),
		);
	});

	test("deduplicates pending resolution and reuses the completed result", async () => {
		clearHyperframesPreviewMediaCache();
		const key = hyperframesPreviewMediaCacheKey({
			projectId: "project",
			elementId: "scene",
			html: "<html>source</html>",
		});
		let calls = 0;
		const resolve = async () => {
			calls += 1;
			await Promise.resolve();
			return "<html>resolved</html>";
		};

		const first = resolveCachedHyperframesPreviewMedia({ key, resolve });
		const second = resolveCachedHyperframesPreviewMedia({ key, resolve });
		expect(first).toBe(second);
		expect(await first).toBe("<html>resolved</html>");
		expect(await resolveCachedHyperframesPreviewMedia({ key, resolve })).toBe(
			"<html>resolved</html>",
		);
		expect(calls).toBe(1);
	});

	test("never selects unresolved local media for the iframe", () => {
		expect(
			selectHyperframesPreviewHtml({
				hasLocalMedia: true,
				basePreparedHtml: "<html>opencut-media://local/broken</html>",
				elementId: "scene",
				resolvedMedia: null,
			}),
		).toBeNull();
		expect(
			selectHyperframesPreviewHtml({
				hasLocalMedia: true,
				basePreparedHtml: "unresolved",
				elementId: "scene",
				resolvedMedia: {
					elementId: "scene",
					source: "previous source",
					html: "previous resolved preview",
				},
			}),
		).toBe("previous resolved preview");
	});
});
