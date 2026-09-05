import type {
	HyperframesElement,
	SceneTracks,
	TimelineTrack,
} from "@/timeline";
import { hyperframesPreviewSourceRevision } from "./preview-media";
import { isHyperframesElementActiveAtTime } from "./preview-time";

const presentationKeys = new WeakMap<
	HyperframesElement,
	{ html: string; key: string }
>();

function orderedHyperframesTracks(tracks: SceneTracks): TimelineTrack[] {
	return [...tracks.overlay, tracks.main].reverse();
}

export function findHyperframesPreviewElement({
	tracks,
	timelineTime,
	studioElementId,
}: {
	tracks: SceneTracks;
	timelineTime: number;
	studioElementId?: string | null;
}): HyperframesElement | null {
	const orderedTracks = orderedHyperframesTracks(tracks);
	if (studioElementId) {
		for (const track of orderedTracks) {
			const match = track.elements.find(
				(element): element is HyperframesElement =>
					element.id === studioElementId &&
					element.type === "hyperframes" &&
					element.html.trim().length > 0,
			);
			if (match) return match;
		}
		return null;
	}

	for (const track of orderedTracks) {
		if ("hidden" in track && track.hidden) continue;
		const match = track.elements.find(
			(element): element is HyperframesElement =>
				element.type === "hyperframes" &&
				!element.hidden &&
				!element.renderedMediaId &&
				element.html.trim().length > 0 &&
				isHyperframesElementActiveAtTime({
					startTime: element.startTime,
					duration: element.duration,
					timelineTime,
				}),
		);
		if (match) return match;
	}
	return null;
}

export function hyperframesPreviewPresentationKey(
	element: HyperframesElement,
): string {
	const cached = presentationKeys.get(element);
	if (cached?.html === element.html) return cached.key;
	const key = `${element.id}:${hyperframesPreviewSourceRevision(element.html)}`;
	presentationKeys.set(element, { html: element.html, key });
	return key;
}

export function selectHyperframesTransitionElements({
	desiredElement,
	presentedElement,
}: {
	desiredElement: HyperframesElement | null;
	presentedElement?: HyperframesElement | null;
}): HyperframesElement[] {
	return [
		...(presentedElement &&
		(!desiredElement ||
			hyperframesPreviewPresentationKey(presentedElement) !==
				hyperframesPreviewPresentationKey(desiredElement))
			? [presentedElement]
			: []),
		...(desiredElement ? [desiredElement] : []),
	];
}
