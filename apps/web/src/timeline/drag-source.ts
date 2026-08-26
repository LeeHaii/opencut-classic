import type { TimelineDragData } from "@/timeline/drag";

const TIMELINE_DRAG_MIME = "application/x-timeline-drag";

export type TimelineDragDataResolver = () => Promise<TimelineDragData>;
type TimelineDataTransfer = Pick<DataTransfer, "effectAllowed" | "setData">;

interface ActiveTimelineDrag {
	dragData: TimelineDragData;
	resolveDragData?: TimelineDragDataResolver;
}

/**
 * Owns the state of an in-progress timeline drag session.
 *
 * Exists because browsers restrict `DataTransfer.getData()` to the `drop`
 * event for security — during `dragover`/`dragenter` only `types` is
 * readable. The drop target needs the payload (element type, target
 * element types, source duration) while the pointer is hovering, so we
 * keep a live copy here and hand it out via {@link getActive}.
 */
export class TimelineDragSource {
	private active: ActiveTimelineDrag | null = null;

	begin({
		dataTransfer,
		dragData,
		resolveDragData,
	}: {
		dataTransfer: TimelineDataTransfer;
		dragData: TimelineDragData;
		resolveDragData?: TimelineDragDataResolver;
	}): void {
		dataTransfer.setData(TIMELINE_DRAG_MIME, JSON.stringify(dragData));
		dataTransfer.effectAllowed = "copy";
		this.active = { dragData, resolveDragData };
	}

	end(): void {
		this.active = null;
	}

	getActive(): TimelineDragData | null {
		return this.active?.dragData ?? null;
	}

	resolveForDrop(): TimelineDragData | Promise<TimelineDragData> | null {
		if (!this.active) return null;
		return this.active.resolveDragData?.() ?? this.active.dragData;
	}

	isActive(): boolean {
		return this.active !== null;
	}
}
