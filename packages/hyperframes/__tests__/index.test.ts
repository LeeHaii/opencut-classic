import { describe, expect, test } from "bun:test";
import {
	extractHtml,
	quickValidate,
	auditCompositionAnimation,
} from "../src/extract.js";
import { buildSeedComposition, buildAgentPrompt } from "../src/prompt.js";
import {
	buildMotionDesignSkills,
	deriveStyleDirection,
} from "../src/design-skills.js";
import {
	preparePreviewHtml,
	PREVIEW_MESSAGE_SOURCE,
} from "../src/prepare-preview.js";
import { internalMediaUrl, parseInternalMediaUrl } from "../src/media-url.js";
import { validateSelectedImageUsage } from "../src/selected-image.js";

const sample = (id: string) => `<!DOCTYPE html><html><body>
<div id="${id}" data-composition-id="${id}" data-start="0" data-duration="3" data-width="1920" data-height="1080">
<h1 id="t" class="clip" data-start="0" data-duration="3" data-track-index="0">Hi</h1></div></body></html>`;

describe("extractHtml", () => {
	test("prefers a fenced block with the marker", () => {
		const reply = `Sure:\n\`\`\`html\n${sample("a1")}\n\`\`\`\ndone`;
		expect(extractHtml(reply)).toContain('data-composition-id="a1"');
	});

	test("falls back to a doctype document", () => {
		expect(extractHtml(`noise ${sample("b2")} more`)).toContain(
			'data-composition-id="b2"',
		);
	});

	test("accepts a complete document without a doctype", () => {
		const withoutDoctype = sample("no-doctype").replace("<!DOCTYPE html>", "");
		expect(extractHtml(`Updated scene:\n${withoutDoctype}`)).toContain(
			'data-composition-id="no-doctype"',
		);
	});

	test("recovers entity-escaped composition markup", () => {
		const escaped = sample("escaped")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;");
		expect(extractHtml(`\`\`\`html\n${escaped}\n\`\`\``)).toContain(
			'data-composition-id="escaped"',
		);
	});

	test("returns null without the marker", () => {
		expect(extractHtml("\`\`\`html\n<html></html>\n\`\`\`")).toBeNull();
	});
});

describe("quickValidate", () => {
	test("extracts layout facts", () => {
		const info = quickValidate(sample("c3"));
		expect(info).toMatchObject({
			compositionId: "c3",
			durationSecs: 3,
			width: 1920,
			height: 1080,
		});
		expect(info?.isMaster).toBe(false);
	});

	test("rejects oversized html", () => {
		expect(
			quickValidate(`x`.repeat(1_100_000) + `data-composition-id`),
		).toBeNull();
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
			recentTurns: [
				{
					id: "1",
					role: "user",
					text: "make it red",
					createdAt: new Date().toISOString(),
				},
			],
		});
		expect(prompt).toContain('id="s1"');
		expect(prompt).toContain("USER: make it red");
		expect(prompt).toContain("MOTION DESIGN CRAFT");
		expect(prompt).toContain("FLOW & CHOREOGRAPHY");
		expect(prompt).toContain('window.__timelines["s1"]');
		expect(prompt).toContain("MANDATORY ANIMATION CONTRACT");
		expect(prompt).toContain("literal, stable CSS selector strings");
		expect(seed).toContain('tl.from("#s1 h1"');
		expect(seed).not.toContain("rootSel");
		expect(prompt).not.toContain("${");
	});

	test("selected web images use a local-materialization placeholder", () => {
		const prompt = buildAgentPrompt({
			request: "Use a real photo of Mount Fuji",
			compositionId: "image-scene",
			durationSecs: 5,
			width: 1920,
			height: 1080,
			fps: 30,
			selectedImage: {
				id: "image-abc123",
				name: "Mount Fuji",
				placeholder: "opencut-selected-image://abc123",
				sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Fuji.jpg",
				attribution: "Example Author — CC BY-SA",
				license: "CC BY-SA",
				width: 2400,
				height: 1600,
			},
		});
		expect(prompt).toContain("exact HTML src: opencut-selected-image://abc123");
		expect(prompt).toContain('data-opencut-selected-image="image-abc123"');
		expect(prompt).toContain("Never use the remote source URL in HTML");
		expect(prompt).toContain("Example Author — CC BY-SA");
	});

	test("existing scenes demand a complete updated document", () => {
		const currentComposition = sample("existing-scene");
		const prompt = buildAgentPrompt({
			request: "Make the title red",
			compositionId: "existing-scene",
			durationSecs: 3,
			width: 1920,
			height: 1080,
			fps: 30,
			currentComposition,
		});
		expect(prompt).toContain("Update the selected existing HyperFrames");
		expect(prompt).toContain("Existing composition source");
		expect(prompt).toContain(currentComposition);
		expect(prompt).toContain("Return the COMPLETE updated standalone HTML");
		expect(prompt).not.toContain("Create ONE NEW HyperFrames");
	});
});

describe("selected image validation", () => {
	const requirement = {
		id: "image-abc123",
		placeholder: "opencut-selected-image://abc123",
	};

	test("accepts one marked img using the exact placeholder", () => {
		const html = `<img data-opencut-selected-image="image-abc123" src="opencut-selected-image://abc123" alt="Selected">`;
		expect(validateSelectedImageUsage(html, requirement)).toEqual({
			valid: true,
		});
	});

	test("rejects missing, duplicated, unmarked, and non-img placeholders", () => {
		expect(validateSelectedImageUsage("<div></div>", requirement).valid).toBe(
			false,
		);
		expect(
			validateSelectedImageUsage(
				`<img data-opencut-selected-image="image-abc123" src="${requirement.placeholder}"><img src="${requirement.placeholder}">`,
				requirement,
			).valid,
		).toBe(false);
		expect(
			validateSelectedImageUsage(
				`<img src="${requirement.placeholder}">`,
				requirement,
			).valid,
		).toBe(false);
		expect(
			validateSelectedImageUsage(
				`<div data-opencut-selected-image="image-abc123" data-src="${requirement.placeholder}"></div>`,
				requirement,
			).valid,
		).toBe(false);
	});
});

describe("auditCompositionAnimation", () => {
	test("seed composition passes the animation audit", () => {
		const seed = buildSeedComposition({
			compositionId: "a1",
			width: 1280,
			height: 720,
			durationSecs: 4,
			fps: 30,
		});
		expect(auditCompositionAnimation(seed)).toEqual({
			hasTimeline: true,
			hasTweens: true,
		});
	});

	test("static compositions fail the audit", () => {
		const staticDoc = sample("s9");
		expect(auditCompositionAnimation(staticDoc)).toEqual({
			hasTimeline: false,
			hasTweens: false,
		});

		const timelineWithoutTweens = `<!DOCTYPE html><html><body>
<div data-composition-id="t2" data-start="0" data-duration="3"></div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["t2"] = gsap.timeline({ paused: true });</script>
</body></html>`;
		expect(auditCompositionAnimation(timelineWithoutTweens)).toEqual({
			hasTimeline: true,
			hasTweens: false,
		});
	});
});

describe("design skills", () => {
	test("guidance scales beats to duration", () => {
		const short = buildMotionDesignSkills(3);
		const long = buildMotionDesignSkills(30);
		expect(short).toContain("about 2 beats");
		expect(long).toContain("about 7 beats");
	});

	test("derives style direction from keywords", () => {
		const tech = deriveStyleDirection(
			"data dashboard for a developer analytics platform",
		);
		expect(tech.name).toBe("Dark tech / AI-native");

		const hype = deriveStyleDirection("hype gaming launch trailer");
		expect(hype.name).toBe("Bold kinetic / hype edit");

		const fallback = deriveStyleDirection(
			"something completely unclassifiable",
		);
		expect(fallback.name).toBe("Clean modern minimal");
	});
});

describe("preparePreviewHtml", () => {
	test("appends bridge and strips nothing from source", () => {
		const prepared = preparePreviewHtml(sample("d4"));
		expect(prepared).toContain(PREVIEW_MESSAGE_SOURCE);
		expect(prepared).toContain('data.action === "snapshot"');
		expect(prepared).toContain('post("snapshot"');
		expect(prepared).toContain('data.action === "select-element"');
		expect(prepared).toContain('post("element-selected"');
		expect(prepared).toContain('post("motion-snapshot"');
		expect(prepared).toContain('data.action === "scan-motion"');
		expect(prepared).toContain('post("selected-image-loaded"');
		expect(prepared).toContain('post("selected-image-error"');
		expect(prepared).toContain("data-opencut-studio-selection");
		expect(prepared).toContain("</body>");
	});

	test("replaces cdn gsap when inline source provided", () => {
		const html = `<html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"><\/script></head>${sample("e5")}`;
		const prepared = preparePreviewHtml(html, {
			gsapSource: "window.__gsapInline = true;",
		});
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
