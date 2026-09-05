export function isHyperframesElementActiveAtTime({
	startTime,
	duration,
	timelineTime,
}: {
	startTime: number;
	duration: number;
	timelineTime: number;
}): boolean {
	return (
		duration > 0 &&
		timelineTime >= startTime &&
		timelineTime < startTime + duration
	);
}

function lastVisibleTick(duration: number): number {
	return Math.max(0, duration - 1);
}

/**
 * Converts project time to the iframe's source time. Normal previews return
 * null outside the host clip's half-open range so an end-edge seek cannot
 * blank the iframe in the short interval before React unmounts the overlay.
 */
export function getHyperframesPreviewTimeSeconds({
	startTime,
	duration,
	trimStart,
	sourceDuration,
	timelineTime,
	ticksPerSecond,
	focused = false,
}: {
	startTime: number;
	duration: number;
	trimStart: number;
	sourceDuration?: number;
	timelineTime: number;
	ticksPerSecond: number;
	focused?: boolean;
}): number | null {
	if (
		!focused &&
		!isHyperframesElementActiveAtTime({ startTime, duration, timelineTime })
	) {
		return null;
	}

	if (focused) {
		const maxSourceTime = lastVisibleTick(sourceDuration ?? duration);
		const requestedSourceTime = timelineTime - startTime + trimStart;
		return (
			Math.max(0, Math.min(maxSourceTime, requestedSourceTime)) / ticksPerSecond
		);
	}

	const localTime = Math.max(
		0,
		Math.min(lastVisibleTick(duration), timelineTime - startTime),
	);
	const maxSourceTime = lastVisibleTick(sourceDuration ?? duration + trimStart);
	return Math.min(maxSourceTime, localTime + trimStart) / ticksPerSecond;
}
