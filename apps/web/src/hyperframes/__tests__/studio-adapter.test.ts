import { describe, expect, test } from "bun:test";
import {
	getStudioLayerAnimations,
	moveStudioKeyframe,
	scaleStudioLayerAnimations,
	shiftStudioLayerAnimations,
} from "../studio-animations";
import {
	applyStudioLayerPatches,
	deleteStudioLayer,
	type StudioLayer,
} from "../studio-document";

function layer(overrides: Partial<StudioLayer> = {}): StudioLayer {
	return {
		key: "headline",
		id: null,
		hfId: "headline",
		selector: '[data-hf-id="headline"]',
		label: "Headline",
		tag: "h1",
		text: "Hello",
		start: 0,
		duration: 3,
		track: 0,
		playbackStart: null,
		playbackStartAttribute: null,
		hidden: false,
		styles: { color: "white" },
		...overrides,
	};
}

describe("Scene Studio source adapter", () => {
	test("patches data-hf-id elements without reserializing the document", async () => {
		const html = `<!DOCTYPE html>
<html>
  <body>
    <!-- formatting must survive -->
    <h1 data-hf-id="headline" data-start="0" style="color: white">Hello</h1>
    <script>window.keepExactly = "yes";</script>
  </body>
</html>`;
		const patched = await applyStudioLayerPatches({
			html,
			layer: layer(),
			operations: [
				{ type: "inline-style", property: "opacity", value: "0.75" },
				{ type: "attribute", property: "start", value: "1.250" },
			],
		});

		expect(patched).toContain(
			'data-hf-id="headline" data-start="1.250" style="color: white; opacity: 0.75"',
		);
		expect(patched).toContain("    <!-- formatting must survive -->");
		expect(patched).toContain('<script>window.keepExactly = "yes";</script>');
	});

	test("deletes an identified nested block without touching its siblings", async () => {
		const html = `<section><div data-hf-id="headline"><div>nested</div></div><p>keep</p></section>`;
		const patched = await deleteStudioLayer({
			html,
			layer: layer({ tag: "div" }),
		});
		expect(patched).toBe(`<section><p>keep</p></section>`);
	});
});

describe("Scene Studio animation adapter", () => {
	const html = `<!DOCTYPE html><html><body>
<div data-composition-id="scene" data-duration="3" data-width="1920" data-height="1080">
  <h1 id="title" data-start="0" data-duration="3" data-track-index="0">Hello</h1>
</div>
<script>
const tl = gsap.timeline({ paused: true });
tl.to("#title", {
  duration: 2,
  keyframes: {
    "0%": { x: 0, opacity: 0 },
    "100%": { x: 100, opacity: 1 }
  }
}, 0);
</script></body></html>`;
	const titleLayer = layer({
		key: "title",
		id: "title",
		hfId: null,
		selector: '[id="title"]',
	});

	test("maps authored GSAP keyframes onto clip percentages", () => {
		const result = getStudioLayerAnimations({ html, layer: titleLayer });
		expect(result.animations).toHaveLength(1);
		expect(result.keyframes.map((keyframe) => keyframe.percentage)).toEqual([
			0, 100,
		]);
		expect(result.keyframes.map((keyframe) => keyframe.clipPercentage)).toEqual(
			[0, 66.66666666666666],
		);
	});

	test("retimes a keyframe through the browser-safe Acorn writer", async () => {
		const result = getStudioLayerAnimations({ html, layer: titleLayer });
		const animationId = result.animations[0]?.id;
		expect(animationId).toBeTruthy();
		const patched = await moveStudioKeyframe({
			html,
			animationId: animationId!,
			fromPercentage: 0,
			toPercentage: 25,
		});
		const reparsed = getStudioLayerAnimations({
			html: patched,
			layer: titleLayer,
		});
		expect(reparsed.keyframes.map((keyframe) => keyframe.percentage)).toEqual([
			25, 100,
		]);
	});

	test("keeps tween timing aligned when a layer is moved or trimmed", async () => {
		const shifted = await shiftStudioLayerAnimations({
			html,
			layer: titleLayer,
			delta: 1,
		});
		const shiftedAnimations = getStudioLayerAnimations({
			html: shifted,
			layer: { ...titleLayer, start: 1 },
		}).animations;
		expect(shiftedAnimations[0]?.resolvedStart).toBe(1);

		const scaled = await scaleStudioLayerAnimations({
			html: shifted,
			layer: { ...titleLayer, start: 1 },
			start: 1,
			duration: 1.5,
		});
		const scaledAnimations = getStudioLayerAnimations({
			html: scaled,
			layer: { ...titleLayer, start: 1, duration: 1.5 },
		}).animations;
		expect(scaledAnimations[0]?.resolvedStart).toBe(1);
		expect(scaledAnimations[0]?.duration).toBe(1);
	});
});
