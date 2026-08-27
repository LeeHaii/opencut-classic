import { expect, test } from "bun:test";
import { searchStockMedia } from "../scenes/stock-search";

test("maps Pixabay rendition thumbnails and uses a small streaming preview", async () => {
	const originalFetch = globalThis.fetch;
	const requestedUrls: string[] = [];
	globalThis.fetch = Object.assign(
		async (input: string | URL | Request) => {
			requestedUrls.push(String(input));
			return Response.json({
				hits: [
					{
						id: 2040841,
						pageURL: "https://pixabay.com/videos/id-2040841/",
						duration: 14,
						user: "Natures_Embrace",
						videos: {
							large: { url: "", width: 3840, height: 2160, size: 0 },
							medium: {
								url: "https://cdn.example/video_medium.mp4",
								width: 1920,
								height: 1080,
								thumbnail: "https://cdn.example/video_medium.jpg",
							},
							tiny: {
								url: "https://cdn.example/video_tiny.mp4",
								width: 640,
								height: 360,
								thumbnail: "https://cdn.example/video_tiny.jpg",
							},
						},
					},
				],
			});
		},
		{ preconnect: originalFetch.preconnect },
	);

	try {
		const { candidates } = await searchStockMedia({
			query: { query: "japan", providers: ["pixabay"], kind: "video" },
			context: { pexelsKey: "", pixabayKey: "test-key" },
		});

		expect(requestedUrls).toHaveLength(1);
		expect(requestedUrls[0]).toContain("https://pixabay.com/api/videos?");
		expect(candidates).toEqual([
			expect.objectContaining({
				id: "pixabay:2040841",
				sourceUrl: "https://cdn.example/video_medium.mp4",
				previewUrl: "https://cdn.example/video_tiny.mp4",
				thumbnailUrl: "https://cdn.example/video_tiny.jpg",
				width: 1920,
				height: 1080,
			}),
		]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
