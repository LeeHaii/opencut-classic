import { describe, expect, test } from "bun:test";
import {
	getHyperframesPreviewTimeSeconds,
	isHyperframesElementActiveAtTime,
} from "../preview-time";

const TICKS_PER_SECOND = 120_000;

describe("Hyperframes preview time", () => {
	test("uses a half-open host range at the segment end", () => {
		const startTime = 10 * TICKS_PER_SECOND;
		const duration = 5 * TICKS_PER_SECOND;
		expect(
			isHyperframesElementActiveAtTime({
				startTime,
				duration,
				timelineTime: startTime + duration - 1,
			}),
		).toBe(true);
		expect(
			isHyperframesElementActiveAtTime({
				startTime,
				duration,
				timelineTime: startTime + duration,
			}),
		).toBe(false);
	});

	test("does not send an out-of-range terminal seek to a normal preview", () => {
		const startTime = 10 * TICKS_PER_SECOND;
		const duration = 5 * TICKS_PER_SECOND;
		expect(
			getHyperframesPreviewTimeSeconds({
				startTime,
				duration,
				trimStart: 0,
				timelineTime: startTime + duration,
				ticksPerSecond: TICKS_PER_SECOND,
			}),
		).toBeNull();
		expect(
			getHyperframesPreviewTimeSeconds({
				startTime,
				duration,
				trimStart: 0,
				timelineTime: startTime + duration - 1,
				ticksPerSecond: TICKS_PER_SECOND,
			}),
		).toBe((duration - 1) / TICKS_PER_SECOND);
	});

	test("keeps focused studio previews on their last visible tick", () => {
		const duration = 5 * TICKS_PER_SECOND;
		expect(
			getHyperframesPreviewTimeSeconds({
				startTime: 0,
				duration,
				trimStart: 0,
				sourceDuration: duration,
				timelineTime: duration,
				ticksPerSecond: TICKS_PER_SECOND,
				focused: true,
			}),
		).toBe((duration - 1) / TICKS_PER_SECOND);
	});
});
