import { describe, expect, test } from "bun:test";
import type { HyperframesElement, SceneTracks, VideoTrack } from "@/timeline";
import type { MediaTime } from "@/wasm";
import {
	findHyperframesPreviewElement,
	selectHyperframesTransitionElements,
} from "../preview-selection";

const TICKS_PER_SECOND = 120_000;

function mediaTime(value: number): MediaTime {
	// Test fixtures need branded integer ticks without initializing WebAssembly.
	const isTick = (tick: number): tick is MediaTime => Number.isInteger(tick);
	if (!isTick(value)) throw new Error("Expected integer fixture ticks");
	return value;
}

function scene({
	id,
	startSeconds,
}: {
	id: string;
	startSeconds: number;
}): HyperframesElement {
	return {
		id,
		name: id,
		type: "hyperframes",
		compositionId: id,
		html: `<div data-composition-id="${id}" data-duration="1"></div>`,
		width: 1920,
		height: 1080,
		startTime: mediaTime(startSeconds * TICKS_PER_SECOND),
		duration: mediaTime(TICKS_PER_SECOND),
		trimStart: mediaTime(0),
		trimEnd: mediaTime(0),
		params: {},
	};
}

function tracks(elements: HyperframesElement[]): SceneTracks {
	const main: VideoTrack = {
		id: "main",
		name: "Main",
		type: "video",
		elements,
		muted: false,
		hidden: false,
	};
	return { main, overlay: [], audio: [] };
}

describe("Hyperframes preview transitions", () => {
	test("switches ownership at the half-open boundary", () => {
		const first = scene({ id: "first", startSeconds: 0 });
		const second = scene({ id: "second", startSeconds: 1 });
		const timeline = tracks([first, second]);
		expect(
			findHyperframesPreviewElement({
				tracks: timeline,
				timelineTime: TICKS_PER_SECOND - 1,
			})?.id,
		).toBe("first");
		expect(
			findHyperframesPreviewElement({
				tracks: timeline,
				timelineTime: TICKS_PER_SECOND,
			})?.id,
		).toBe("second");
	});

	test("keeps the outgoing scene beneath an incoming scene", () => {
		const selected = selectHyperframesTransitionElements({
			presentedElement: scene({ id: "first", startSeconds: 0 }),
			desiredElement: scene({ id: "second", startSeconds: 1 }),
		});
		expect(selected.map((element) => element.id)).toEqual(["first", "second"]);
	});

	test("keeps the displayed source revision when the same scene is edited", () => {
		const original = scene({ id: "first", startSeconds: 0 });
		const edited = { ...original, html: original.html + "<p>edited</p>" };
		expect(
			selectHyperframesTransitionElements({
				presentedElement: original,
				desiredElement: edited,
			}),
		).toEqual([original, edited]);
	});

	test("retains only the actual displayed document through rapid A -> B -> C", () => {
		const a = scene({ id: "A", startSeconds: 0 }),
			b = scene({ id: "B", startSeconds: 1 }),
			c = scene({ id: "C", startSeconds: 2 });
		expect(
			selectHyperframesTransitionElements({
				presentedElement: a,
				desiredElement: b,
			}),
		).toEqual([a, b]);
		expect(
			selectHyperframesTransitionElements({
				presentedElement: a,
				desiredElement: c,
			}),
		).toEqual([a, c]);
		expect(
			selectHyperframesTransitionElements({
				presentedElement: a,
				desiredElement: null,
			}),
		).toEqual([a]);
		expect(
			selectHyperframesTransitionElements({
				presentedElement: a,
				desiredElement: a,
			}),
		).toEqual([a]);
	});

	test("uses rendered video as the only normal-preview representation", () => {
		const rendered = {
			...scene({ id: "rendered", startSeconds: 0 }),
			renderedMediaId: "rendered-video",
		};
		expect(
			findHyperframesPreviewElement({
				tracks: tracks([rendered]),
				timelineTime: 0,
			}),
		).toBeNull();
	});
});
