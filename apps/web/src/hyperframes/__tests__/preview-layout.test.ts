import { describe, expect, test } from "bun:test";
import { getHyperframesPreviewLayout } from "../preview-layout";

describe("HyperFrames preview layout", () => {
	test("preserves a landscape composition's intrinsic viewport while fitting", () => {
		const layout = getHyperframesPreviewLayout({
			elementSize: { width: 1920, height: 1080 },
			projectCanvasSize: { width: 1920, height: 1080 },
			sceneViewportSize: { width: 960, height: 540 },
			transform: { position: { x: 0, y: 0 }, scaleX: 1, scaleY: 1 },
		});

		expect(layout).toEqual({
			left: 480,
			top: 270,
			displayedWidth: 960,
			displayedHeight: 540,
			iframeScaleX: 0.5,
			iframeScaleY: 0.5,
		});
	});

	test("letterboxes a portrait composition without cropping", () => {
		const layout = getHyperframesPreviewLayout({
			elementSize: { width: 1080, height: 1920 },
			projectCanvasSize: { width: 1920, height: 1080 },
			sceneViewportSize: { width: 960, height: 540 },
			transform: { position: { x: 0, y: 0 }, scaleX: 1, scaleY: 1 },
		});

		expect(layout.displayedWidth).toBeCloseTo(303.75);
		expect(layout.displayedHeight).toBe(540);
		expect(layout.left).toBe(480);
		expect(layout.top).toBe(270);
	});
});
