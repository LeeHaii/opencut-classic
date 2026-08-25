"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
	PARENT_MESSAGE_SOURCE,
	PREVIEW_MESSAGE_SOURCE,
	preparePreviewHtml,
} from "@opencut/hyperframes";
import { getElementLocalTime } from "@/animation";
import { useEditor } from "@/editor/use-editor";
import {
	buildTransformFromParams,
	readBlendModeFromParams,
	readOpacityFromParams,
} from "@/rendering";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import type { PreviewOverlaySourceResult } from "@/preview/overlays";
import type {
	HyperframesElement,
	SceneTracks,
	TimelineTrack,
} from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { getHyperframesPreviewLayout } from "./preview-layout";

interface PreviewMessage {
	source?: string;
	type?: string;
	message?: string;
}

interface HyperframesPreviewProps {
	element: HyperframesElement;
	projectCanvasSize: { width: number; height: number };
	sceneViewportSize: { width: number; height: number };
	timelineTime: number;
}

function postControl({
	iframe,
	action,
	timeSeconds,
}: {
	iframe: HTMLIFrameElement | null;
	action: "play" | "pause" | "seek";
	timeSeconds?: number;
}) {
	iframe?.contentWindow?.postMessage(
		{
			source: PARENT_MESSAGE_SOURCE,
			type: "control",
			action,
			...(timeSeconds == null ? {} : { timeSeconds }),
		},
		"*",
	);
}

function elementLocalTimeSeconds({
	element,
	timelineTime,
}: {
	element: HyperframesElement;
	timelineTime: number;
}): number {
	const localTicks = Math.max(
		0,
		Math.min(element.duration, timelineTime - element.startTime),
	);
	return (localTicks + element.trimStart) / TICKS_PER_SECOND;
}

function HyperframesPreview({
	element,
	projectCanvasSize,
	sceneViewportSize,
	timelineTime,
}: HyperframesPreviewProps) {
	const editor = useEditor();
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [error, setError] = useState<string | null>(null);
	const preparedHtml = useMemo(
		() => preparePreviewHtml(element.html),
		[element.html],
	);
	const localTime = getElementLocalTime({
		timelineTime,
		elementStartTime: element.startTime,
		elementDuration: element.duration,
	});
	const transform = resolveTransformAtTime({
		baseTransform: buildTransformFromParams({ params: element.params }),
		animations: element.animations,
		localTime,
	});
	const {
		left,
		top,
		displayedWidth,
		displayedHeight,
		iframeScaleX,
		iframeScaleY,
	} = getHyperframesPreviewLayout({
		elementSize: { width: element.width, height: element.height },
		projectCanvasSize,
		sceneViewportSize,
		transform,
	});

	useEffect(() => {
		const syncTime = (time: number) => {
			postControl({
				iframe: iframeRef.current,
				action: "seek",
				timeSeconds: elementLocalTimeSeconds({ element, timelineTime: time }),
			});
		};
		const syncPlaybackState = () => {
			postControl({
				iframe: iframeRef.current,
				action: editor.playback.getIsPlaying() ? "play" : "pause",
			});
		};
		const handleMessage = (event: MessageEvent<PreviewMessage>) => {
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (event.data?.source !== PREVIEW_MESSAGE_SOURCE) return;
			if (event.data.type === "ready") {
				setError(null);
				syncTime(editor.playback.getCurrentTime());
				syncPlaybackState();
			} else if (event.data.type === "error") {
				setError(
					event.data.message ?? "HyperFrames preview failed to initialize.",
				);
			}
		};

		window.addEventListener("message", handleMessage);
		const unsubscribePlayback = editor.playback.subscribe(syncPlaybackState);
		const unsubscribeUpdate = editor.playback.onUpdate(syncTime);
		const unsubscribeSeek = editor.playback.onSeek(syncTime);
		return () => {
			window.removeEventListener("message", handleMessage);
			unsubscribePlayback();
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [editor, element]);

	return (
		<div
			className="absolute overflow-hidden"
			style={{
				left,
				top,
				width: displayedWidth,
				height: displayedHeight,
				opacity: readOpacityFromParams({ params: element.params }),
				mixBlendMode: readBlendModeFromParams({ params: element.params }),
				transform: `translate(-50%, -50%) rotate(${transform.rotate}deg) scale(${Math.sign(transform.scaleX) || 1}, ${Math.sign(transform.scaleY) || 1})`,
			}}
		>
			<iframe
				ref={iframeRef}
				title={`HyperFrames preview: ${element.name}`}
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				srcDoc={preparedHtml}
				className="absolute left-1/2 top-1/2 border-0"
				style={{
					width: element.width,
					height: element.height,
					transform: `translate(-50%, -50%) scale(${iframeScaleX}, ${iframeScaleY})`,
					transformOrigin: "center",
				}}
				onLoad={() => {
					postControl({
						iframe: iframeRef.current,
						action: "seek",
						timeSeconds: elementLocalTimeSeconds({ element, timelineTime }),
					});
				}}
			/>
			{error && (
				<div className="bg-destructive/85 absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] text-white">
					{error}
				</div>
			)}
		</div>
	);
}

export function getHyperframesPreviewOverlaySource({
	tracks,
	timelineTime,
	projectCanvasSize,
	studioElementId,
}: {
	tracks: SceneTracks;
	timelineTime: number;
	projectCanvasSize: { width: number; height: number };
	/** Scene Studio focus mode: always render this element, ignoring playhead. */
	studioElementId?: string | null;
}): PreviewOverlaySourceResult {
	const orderedTracks: TimelineTrack[] = [
		...tracks.overlay,
		tracks.main,
	].reverse();

	if (studioElementId) {
		for (const track of orderedTracks) {
			const match = track.elements.find(
				(element): element is HyperframesElement =>
					element.id === studioElementId &&
					element.type === "hyperframes" &&
					element.html.trim().length > 0,
			);
			if (match) {
				return buildStudioOverlay({
					element: match,
					projectCanvasSize,
				});
			}
		}
		return { definitions: [], instances: [] };
	}

	let activeElement: HyperframesElement | null = null;
	for (const track of orderedTracks) {
		if ("hidden" in track && track.hidden) continue;
		const match = track.elements.find(
			(element): element is HyperframesElement =>
				element.type === "hyperframes" &&
				!element.hidden &&
				element.html.trim().length > 0 &&
				timelineTime >= element.startTime &&
				timelineTime < element.startTime + element.duration,
		);
		if (match) {
			activeElement = match;
			break;
		}
	}

	if (!activeElement) {
		return { definitions: [], instances: [] };
	}

	const element = activeElement;
	return {
		definitions: [],
		instances: [
			{
				id: `hyperframes-preview-${element.id}`,
				mount: { kind: "scene" },
				plane: "under-interaction",
				pointerEvents: "none",
				zIndex: 20,
				render: ({ sceneWidth, sceneHeight }) => (
					<HyperframesPreview
						element={element}
						projectCanvasSize={projectCanvasSize}
						sceneViewportSize={{ width: sceneWidth, height: sceneHeight }}
						timelineTime={timelineTime}
					/>
				),
			},
		],
	};
}

function buildStudioOverlay({
	element,
	projectCanvasSize,
}: {
	element: HyperframesElement;
	projectCanvasSize: { width: number; height: number };
}): PreviewOverlaySourceResult {
	return {
		definitions: [],
		instances: [
			{
				id: `hyperframes-studio-${element.id}`,
				mount: { kind: "scene" },
				plane: "over-interaction",
				pointerEvents: "none",
				zIndex: 30,
				render: ({ sceneWidth, sceneHeight }) => (
					<HyperframesPreview
						element={element}
						projectCanvasSize={projectCanvasSize}
						sceneViewportSize={{ width: sceneWidth, height: sceneHeight }}
						timelineTime={0}
					/>
				),
			},
		],
	};
}
