"use client";

import { useCallback, useMemo } from "react";
import { quickValidate } from "@opencut/hyperframes";
import { useEditor } from "@/editor/use-editor";
import type {
	HyperframesElement,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
} from "@/timeline";
import { mediaTimeFromSeconds } from "@/wasm";
import { useHyperframesStudioStore } from "./studio-store";

export interface LocatedStudioElement {
	trackId: string;
	element: HyperframesElement;
}

export function findStudioElement({
	tracks,
	elementId,
}: {
	tracks: SceneTracks | null;
	elementId: string | null;
}): LocatedStudioElement | null {
	if (!tracks || !elementId) return null;
	const allTracks: TimelineTrack[] = [...tracks.overlay, tracks.main];
	for (const track of allTracks) {
		for (const element of track.elements) {
			if (element.id === elementId && element.type === "hyperframes") {
				return { trackId: track.id, element };
			}
		}
	}
	return null;
}

export function useActiveStudioElement() {
	const editor = useEditor();
	const activeElementId = useHyperframesStudioStore(
		(state) => state.activeElementId,
	);
	const tracks = useEditor(
		(current) => current.scenes.getActiveSceneOrNull()?.tracks ?? null,
	);
	const located = useMemo(
		() => findStudioElement({ tracks, elementId: activeElementId }),
		[tracks, activeElementId],
	);

	const updateElement = useCallback(
		(patch: Partial<TimelineElement>) => {
			if (!located) return false;
			editor.timeline.updateElements({
				updates: [
					{
						trackId: located.trackId,
						elementId: located.element.id,
						patch,
					},
				],
			});
			return true;
		},
		[editor, located],
	);

	const commitHtml = useCallback(
		({
			html,
			syncCompositionMetadata = false,
		}: {
			html: string;
			syncCompositionMetadata?: boolean;
		}) => {
			if (!located || html === located.element.html) return false;
			const info = quickValidate(html);
			if (!info) return false;
			const metadataPatch = syncCompositionMetadata
				? {
						compositionId: info.compositionId,
						width: info.width,
						height: info.height,
						duration: mediaTimeFromSeconds({ seconds: info.durationSecs }),
						sourceDuration: mediaTimeFromSeconds({
							seconds: info.durationSecs,
						}),
					}
				: {};
			return updateElement({
				...metadataPatch,
				html,
				renderedMediaId: undefined,
				renderHash: undefined,
			});
		},
		[located, updateElement],
	);

	return { editor, activeElementId, located, commitHtml, updateElement };
}
