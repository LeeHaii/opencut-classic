import { EditorCore } from "@/core";
import { Command, type CommandResult } from "@/commands/base-command";
import type {
	SceneTracks,
	TimelineElement,
	UploadAudioElement,
	VideoElement,
	ImageElement,
} from "@/timeline";
import { findTrackInSceneTracks, updateElementInSceneTracks } from "@/timeline";
import { ZERO_MEDIA_TIME, mediaTimeFromSeconds, type MediaTime } from "@/wasm";

export type ReplaceableMediaType = "video" | "image" | "audio";

/**
 * Swaps the media behind an existing timeline segment (CapCut-style
 * drag-to-replace). Keeps the element's id, name, position and params;
 * resets trim/retime and clamps the duration to the incoming media.
 * Images have no intrinsic length, so they keep the segment duration.
 */
export class ReplaceMediaCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly mediaId: string;
	private readonly mediaType: ReplaceableMediaType;
	private readonly assetDurationSec: number | undefined;

	constructor({
		trackId,
		elementId,
		mediaId,
		mediaType,
		assetDurationSec,
	}: {
		trackId: string;
		elementId: string;
		mediaId: string;
		mediaType: ReplaceableMediaType;
		assetDurationSec?: number;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.mediaId = mediaId;
		this.mediaType = mediaType;
		this.assetDurationSec = assetDurationSec;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const tracks = editor.scenes.getActiveScene().tracks;
		this.savedState = tracks;

		const track = findTrackInSceneTracks({ tracks, trackId: this.trackId });
		const element = track?.elements.find(
			(candidate) => candidate.id === this.elementId,
		);
		if (!track || !element) {
			return undefined;
		}

		const nextElement = buildReplacedElement({
			element,
			mediaId: this.mediaId,
			mediaType: this.mediaType,
			assetDurationSec: this.assetDurationSec,
		});

		const updatedTracks = updateElementInSceneTracks({
			tracks,
			trackId: this.trackId,
			elementId: this.elementId,
			update: () => nextElement,
		});
		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}

export function buildReplacedElement({
	element,
	mediaId,
	mediaType,
	assetDurationSec,
}: {
	element: TimelineElement;
	mediaId: string;
	mediaType: ReplaceableMediaType;
	assetDurationSec?: number;
}): TimelineElement {
	const assetDuration =
		assetDurationSec != null && assetDurationSec > 0
			? mediaTimeFromSeconds({ seconds: assetDurationSec })
			: null;
	const hasIntrinsicDuration = mediaType !== "image" && assetDuration !== null;
	const nextDuration: MediaTime =
		hasIntrinsicDuration && assetDuration
			? element.duration < assetDuration
				? element.duration
				: assetDuration
			: element.duration;

	const previousEffects =
		element.type === "video" ? element.effects : undefined;
	const previousMasks = element.type === "video" ? element.masks : undefined;
	const previousHidden = element.type === "video" ? element.hidden : undefined;

	const common = {
		id: element.id,
		name: element.name,
		startTime: element.startTime,
		duration: nextDuration,
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		sourceDuration: assetDuration ?? undefined,
		animations: element.animations,
		params: element.params,
	};

	switch (mediaType) {
		case "video": {
			const next: VideoElement = {
				...common,
				type: "video",
				mediaId,
				hidden: previousHidden,
				effects: previousEffects,
				masks: previousMasks,
			};
			return next;
		}
		case "image": {
			const next: ImageElement = {
				...common,
				type: "image",
				mediaId,
			};
			return next;
		}
		case "audio": {
			const previousBuffer =
				element.type === "audio" ? element.buffer : undefined;
			const next: UploadAudioElement = {
				...common,
				type: "audio",
				sourceType: "upload",
				mediaId,
				buffer: previousBuffer,
			};
			return next;
		}
	}
}
