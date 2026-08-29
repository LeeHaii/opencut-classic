import { describe, expect, test } from "bun:test";
import {
	addStudioEditableAnimation,
	addStudioKeyframe,
	buildStudioTimelineKeyframes,
	getStudioLayerAnimations,
	interpolateStudioKeyframeProperties,
	moveStudioKeyframe,
	parseStudioRuntimeMotionSnapshot,
	retimeStudioKeyframe,
	removeAllStudioKeyframes,
	scaleStudioLayerAnimations,
	shiftStudioLayerAnimations,
	updateStudioKeyframe,
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

	test("synthesizes visible endpoint keys for a flat GSAP tween", () => {
		const flatHtml = html.replace(
			`keyframes: {
    "0%": { x: 0, opacity: 0 },
    "100%": { x: 100, opacity: 1 }
  }`,
			"x: 100, opacity: 1",
		);
		const result = getStudioLayerAnimations({
			html: flatHtml,
			layer: titleLayer,
		});
		expect(result.keyframes).toHaveLength(2);
		expect(result.keyframes.map((keyframe) => keyframe.percentage)).toEqual([
			0, 100,
		]);
		expect(result.keyframes.every((keyframe) => keyframe.synthesized)).toBe(
			true,
		);
		expect(
			buildStudioTimelineKeyframes({ html: flatHtml, layer: titleLayer })?.cache
				?.keyframes,
		).toHaveLength(2);
	});

	test("converts a flat tween before retiming an endpoint", async () => {
		const flatHtml = html.replace(
			`keyframes: {
    "0%": { x: 0, opacity: 0 },
    "100%": { x: 100, opacity: 1 }
  }`,
			"x: 100, opacity: 1",
		);
		const animation = getStudioLayerAnimations({
			html: flatHtml,
			layer: titleLayer,
		}).animations[0];
		expect(animation).toBeTruthy();
		const patched = await moveStudioKeyframe({
			html: flatHtml,
			animationId: animation!.id,
			fromPercentage: 0,
			toPercentage: 25,
			convertFlat: true,
		});
		const reparsed = getStudioLayerAnimations({
			html: patched,
			layer: titleLayer,
		});
		expect(reparsed.animations[0]?.keyframes).toBeTruthy();
		expect(reparsed.keyframes.map((keyframe) => keyframe.percentage)).toEqual([
			25, 100,
		]);
	});

	test("resizes the tween when its first or last key is dragged", async () => {
		const extended = await retimeStudioKeyframe({
			html,
			layer: titleLayer,
			animationId: getStudioLayerAnimations({ html, layer: titleLayer })
				.animations[0]!.id,
			fromPercentage: 100,
			toClipPercentage: 100,
		});
		const extendedAnimation = getStudioLayerAnimations({
			html: extended,
			layer: titleLayer,
		}).animations[0];
		expect(extendedAnimation?.resolvedStart).toBe(0);
		expect(extendedAnimation?.duration).toBe(3);

		const shortened = await retimeStudioKeyframe({
			html: extended,
			layer: titleLayer,
			animationId: extendedAnimation!.id,
			fromPercentage: 0,
			toClipPercentage: 100 / 3,
		});
		const shortenedResult = getStudioLayerAnimations({
			html: shortened,
			layer: titleLayer,
		});
		expect(shortenedResult.animations[0]?.resolvedStart).toBeCloseTo(1, 5);
		expect(shortenedResult.animations[0]?.duration).toBe(2);
		expect(
			shortenedResult.keyframes.map((keyframe) => keyframe.percentage),
		).toEqual([0, 100]);
	});

	test("converts a flat tween before resizing its boundary", async () => {
		const flatHtml = html.replace(
			`keyframes: {
    "0%": { x: 0, opacity: 0 },
    "100%": { x: 100, opacity: 1 }
  }`,
			"x: 100, opacity: 1",
		);
		const animation = getStudioLayerAnimations({
			html: flatHtml,
			layer: titleLayer,
		}).animations[0]!;
		const patched = await retimeStudioKeyframe({
			html: flatHtml,
			layer: titleLayer,
			animationId: animation.id,
			fromPercentage: 100,
			toClipPercentage: 100,
		});
		const result = getStudioLayerAnimations({
			html: patched,
			layer: titleLayer,
		});
		expect(result.animations[0]?.duration).toBe(3);
		expect(result.animations[0]?.keyframes).toBeTruthy();
		expect(result.keyframes.map((keyframe) => keyframe.percentage)).toEqual([
			0, 100,
		]);
	});

	test("adds an interpolated key at the playhead", async () => {
		const result = getStudioLayerAnimations({ html, layer: titleLayer });
		const animationId = result.animations[0]!.id;
		const properties = interpolateStudioKeyframeProperties({
			keyframes: result.keyframes,
			percentage: 50,
		});
		expect(properties).toEqual({ x: 50, opacity: 0.5 });
		const patched = await addStudioKeyframe({
			html,
			animationId,
			percentage: 50,
			properties,
		});
		expect(
			getStudioLayerAnimations({
				html: patched,
				layer: titleLayer,
			}).keyframes.map((keyframe) => keyframe.percentage),
		).toEqual([0, 50, 100]);
	});

	test("removes synthesized endpoints by collapsing a flat tween to a hold", async () => {
		const flatHtml = html.replace(
			`keyframes: {
    "0%": { x: 0, opacity: 0 },
    "100%": { x: 100, opacity: 1 }
  }`,
			"x: 100, opacity: 1",
		);
		const animation = getStudioLayerAnimations({
			html: flatHtml,
			layer: titleLayer,
		}).animations[0];
		const patched = await removeAllStudioKeyframes({
			html: flatHtml,
			animationId: animation!.id,
			convertFlat: true,
		});
		expect(
			getStudioLayerAnimations({ html: patched, layer: titleLayer }).keyframes,
		).toHaveLength(0);
	});

	test("uses a runtime snapshot when a dynamic selector cannot be attributed", () => {
		const dynamicHtml = html.replace(
			'tl.to("#title", {',
			"const target = '#title';\ntl.to(target, {",
		);
		const result = getStudioLayerAnimations({
			html: dynamicHtml,
			layer: titleLayer,
			runtimeSnapshot: {
				compositionId: "scene",
				animations: [
					{
						id: "runtime:0:title",
						targetKeys: ["title"],
						targetSelector: "title",
						start: 0,
						duration: 2,
						propertyGroup: "position",
						properties: { x: 100 },
						keyframes: [
							{ percentage: 0, properties: {} },
							{ percentage: 100, properties: { x: 100 } },
						],
					},
				],
			},
		});
		expect(result.animations).toHaveLength(0);
		expect(result.runtimeAnimations).toHaveLength(1);
		expect(result.keyframes).toHaveLength(2);
		expect(result.keyframes[0]?.editability).toBe("source");
		expect(result.diagnostics[0]?.kind).toBe("runtime-only");
	});

	test("creates an editable static copy of runtime-discovered motion", async () => {
		const dynamicHtml = html.replace(
			'tl.to("#title", {',
			"const target = '#title';\ntl.to(target, {",
		);
		const runtimeAnimation = {
			id: "runtime:0:title",
			targetKeys: ["title"],
			targetSelector: "title",
			start: 0,
			duration: 2,
			propertyGroup: "position",
			properties: { x: 100 },
			keyframes: [
				{ percentage: 0, properties: { x: 0 } },
				{ percentage: 100, properties: { x: 100 }, ease: "power2.out" },
			],
		};
		const patched = await addStudioEditableAnimation({
			html: dynamicHtml,
			layer: titleLayer,
			animation: runtimeAnimation,
		});
		const result = getStudioLayerAnimations({
			html: patched,
			layer: titleLayer,
			runtimeSnapshot: {
				compositionId: "scene",
				animations: [runtimeAnimation],
			},
		});
		expect(result.animations).toHaveLength(1);
		expect(result.runtimeAnimations).toHaveLength(0);
		expect(result.keyframes.every((keyframe) => keyframe.editability === "direct"))
			.toBe(true);
	});

	test("updates the easing curve for one keyframe segment", async () => {
		const animation = getStudioLayerAnimations({ html, layer: titleLayer })
			.animations[0]!;
		const patched = await updateStudioKeyframe({
			html,
			animationId: animation.id,
			percentage: 100,
			properties: { x: 100, opacity: 1 },
			ease: "power2.inOut",
		});
		const destination = getStudioLayerAnimations({
			html: patched,
			layer: titleLayer,
		}).keyframes.find((keyframe) => keyframe.percentage === 100);
		expect(destination?.ease).toBe("power2.inOut");
	});

	test("rejects unbounded or executable runtime motion payloads", () => {
		expect(
			parseStudioRuntimeMotionSnapshot({
				compositionId: "scene",
				animations: [
					{
						id: "bad",
						targetKeys: ["title"],
						targetSelector: "#title",
						start: 0,
						duration: 1,
						propertyGroup: "position",
						properties: { x: () => 100 },
						keyframes: [],
					},
				],
			}),
		).toBeNull();
		expect(
			parseStudioRuntimeMotionSnapshot({
				compositionId: "scene",
				animations: new Array(2_001).fill({}),
			}),
		).toBeNull();
	});
});
