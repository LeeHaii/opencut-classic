export function clamp01({ value }: { value: number }): number {
	return Math.min(1, Math.max(0, value));
}

export function easeOutCubic({ t }: { t: number }): number {
	const x = clamp01({ value: t });
	return 1 - Math.pow(1 - x, 3);
}

export function easeOutBack({
	t,
	overshoot = 1.4,
}: {
	t: number;
	overshoot?: number;
}): number {
	const x = clamp01({ value: t });
	const c3 = overshoot + 1;
	return 1 + c3 * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2);
}

const ENTRANCE_SEC = 0.8;
const EXIT_SEC = 0.55;

/** Eased entrance progress: 0 → 1 over the first ENTRANCE_SEC seconds. */
export function entranceProgress({ localTime }: { localTime: number }): number {
	return easeOutCubic({ t: localTime / ENTRANCE_SEC });
}

/** Exit factor: 1 → 0 over the last EXIT_SEC seconds. */
export function exitFactor({
	localTime,
	durationSec,
}: {
	localTime: number;
	durationSec: number;
}): number {
	return easeOutCubic({
		t: (durationSec - localTime) / EXIT_SEC,
	});
}

/** Staggered entrance for row index within a group. */
export function staggeredProgress({
	localTime,
	index,
	staggerSec = 0.12,
	entranceSec = 0.6,
}: {
	localTime: number;
	index: number;
	staggerSec?: number;
	entranceSec?: number;
}): number {
	return easeOutCubic({
		t: (localTime - index * staggerSec) / entranceSec,
	});
}
