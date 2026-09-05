import { describe, expect, test } from "bun:test";
import { PreviewSeekChannel } from "../preview-seek-channel";

describe("iframe seek transport", () => {
	test("playback updates cannot starve the first acknowledgment", () => {
		const channel = new PreviewSeekChannel("instance-1");
		const initial = channel.request({ time: 1 });
		for (let time = 2; time <= 100; time++)
			expect(channel.request({ time })).toBeNull();
		const reply = channel.acknowledge(initial?.requestId);
		expect(reply.accepted).toBe(true);
		expect(reply.next?.time).toBe(100);
		expect(channel.acknowledge(reply.next?.requestId).accepted).toBe(true);
	});
	test("explicit seeks reject obsolete replies and converge on the paused target", () => {
		const channel = new PreviewSeekChannel("instance-1");
		const initial = channel.request({ time: 1 });
		channel.request({ time: 4, discontinuity: true });
		channel.request({ time: 8, discontinuity: true });
		const reply = channel.acknowledge(initial?.requestId);
		expect(reply.accepted).toBe(false);
		expect(reply.next?.time).toBe(8);
		expect(channel.acknowledge(reply.next?.requestId).accepted).toBe(true);
	});
	test("retries retain identity; duplicate and foreign replies do not advance the queue", () => {
		const channel = new PreviewSeekChannel("instance-2");
		const initial = channel.request({ time: 2 });
		expect(channel.retry()).toEqual(initial);
		channel.request({ time: 3 });
		expect(channel.acknowledge("instance-1:seek-1")).toEqual({
			accepted: false,
			next: null,
		});
		const next = channel.acknowledge(initial?.requestId).next;
		expect(channel.acknowledge(initial?.requestId).accepted).toBe(false);
		expect(channel.retry()).toEqual(next);
	});
});
