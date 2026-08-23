import { describe, expect, test } from "bun:test";
import { extractHtml, quickValidate } from "../src/extract.js";
import { buildSeedComposition, buildAgentPrompt } from "../src/prompt.js";
import { preparePreviewHtml, PREVIEW_MESSAGE_SOURCE } from "../src/prepare-preview.js";
import { internalMediaUrl, parseInternalMediaUrl } from "../src/media-url.js";

const sample = (id: string) => `<!DOCTYPE html><html><body>
<div id="${id}" data-composition-id="${id}" data-start="0" data-duration="3" data-width="1920" data-height="1080">
<h1 id="t" class="clip" data-start="0" data-duration="3" data-track-index="0">Hi</h1></div></body></html>`;

describe("extractHtml", () => {
	test("prefers a fenced block with the marker", () => {
		const reply = `Sure:\n\`\`\`html\n${sample("a1")}\n\`\`\`\ndone`;
		expect(extractHtml(reply)).toContain('data-composition-id="a1"');
	});

	test("falls back to a doctype document", () => {
		expect(extractHtml(`noise ${sample("b2")} more`)).toContain('data-composition-id="b2"');
	});

	test("returns null without the marker", () => {
		expect(extractHtml("\`\`\`html\n<html></html>\n\`\`\`")).toBeNull();
	});
});

describe("quickValidate", () => {
	test("extracts layout facts", () => {
		const info = quickValidate(sample("c3"));
		expect(info).toMatchObject({ compositionId: "c3", durationSecs: 3, width: 1920, height: 1080 });
		expect(info?.isMaster).toBe(false);
	});

	test("rejects oversized html", () => {
		expect(quickValidate(`x`.repeat(1_100_000) + `data-composition-id`)).toBeNull();
	});
});

describe("prompt + seed", () => {
	test("seed validates and prompt embeds constraints", () => {
		const seed = buildSeedComposition({
			compositionId: "s1",
			width: 1280,
			height: 720,
			durationSecs: 5,
			fps: 30,
		});
		expect(quickValidate(seed)?.compositionId).toBe("s1");

		const prompt = buildAgentPrompt({
			request: "kinetic intro",
			compositionId: "s1",
			durationSecs: 5,
			width: 1280,
			height: 720,
			fps: 30,
			recentTurns: [{ id: "1", role: "user", text: "make it red", createdAt: new Date().toISOString() }],
		});
		expect(prompt).toContain('id="s1"');
		expect(prompt).toContain("USER: make it red");
		expect(prompt).not.toContain("${");
	});
});

describe("preparePreviewHtml", () => {
	test("appends bridge and strips nothing from source", () => {
		const prepared = preparePreviewHtml(sample("d4"));
		expect(prepared).toContain(PREVIEW_MESSAGE_SOURCE);
		expect(prepared).toContain("</body>");
	});

	test("replaces cdn gsap when inline source provided", () => {
		const html = `<html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"><\/script></head>${sample("e5")}`;
		const prepared = preparePreviewHtml(html, { gsapSource: "window.__gsapInline = true;" });
		expect(prepared).toContain("__gsapInline");
		expect(prepared).not.toContain("cdn.jsdelivr.net/npm/gsap");
	});
});

describe("media url codec", () => {
	test("roundtrips windows paths", () => {
		const url = internalMediaUrl("C:\\Users\\me\\my video.mp4");
		expect(url.startsWith("opencut-media://local/")).toBe(true);
		expect(parseInternalMediaUrl(url)).toBe("C:\\Users\\me\\my video.mp4");
	});

	test("roundtrips posix paths", () => {
		const url = internalMediaUrl("/home/me/clip.mp4");
		expect(parseInternalMediaUrl(url)).toBe("/home/me/clip.mp4");
	});
});
