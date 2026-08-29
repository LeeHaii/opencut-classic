"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	PARENT_MESSAGE_SOURCE,
	PREVIEW_MESSAGE_SOURCE,
	isNative,
	nativeInvoke,
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
import { Hand, MousePointer2 } from "lucide-react";
import { getHyperframesPreviewLayout } from "./preview-layout";
import {
	postStudioPreviewAction,
	type StudioPreviewSelection,
} from "./studio-document";
import { parseStudioRuntimeMotionSnapshot } from "./studio-animations";
import { useHyperframesStudioStore } from "./studio-store";

interface PreviewMessage {
	source?: string;
	type?: string;
	message?: string;
	element?: StudioPreviewSelection;
	motion?: unknown;
}

interface HyperframesPreviewProps {
	element: HyperframesElement;
	projectCanvasSize: { width: number; height: number };
	sceneViewportSize: { width: number; height: number };
	timelineTime: number;
	isStudio?: boolean;
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
	focused = false,
}: {
	element: HyperframesElement;
	timelineTime: number;
	focused?: boolean;
}): number {
	if (focused) {
		return Math.max(
			0,
			Math.min(
				(element.sourceDuration ?? element.duration) / TICKS_PER_SECOND,
				(timelineTime - element.startTime + element.trimStart) /
					TICKS_PER_SECOND,
			),
		);
	}
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
	isStudio = false,
}: HyperframesPreviewProps) {
	const editor = useEditor();
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [error, setError] = useState<string | null>(null);
	const studioTool = useHyperframesStudioStore((state) => state.tool);
	const setStudioTool = useHyperframesStudioStore((state) => state.setTool);
	const setPreviewIframe = useHyperframesStudioStore(
		(state) => state.setPreviewIframe,
	);
	const setPreviewSelection = useHyperframesStudioStore(
		(state) => state.setPreviewSelection,
	);
	const setRuntimeMotion = useHyperframesStudioStore(
		(state) => state.setRuntimeMotion,
	);
	const selectedLayerSelector = useHyperframesStudioStore(
		(state) => state.selectedLayerSelector,
	);
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	const basePreparedHtml = useMemo(
		() => preparePreviewHtml(element.html),
		[element.html],
	);
	const [resolvedMediaHtml, setResolvedMediaHtml] = useState<{
		source: string;
		html: string;
	} | null>(null);
	const preparedHtml =
		resolvedMediaHtml?.source === element.html
			? resolvedMediaHtml.html
			: basePreparedHtml;
	useEffect(() => {
		let cancelled = false;
		if (
			!isNative() ||
			!projectId ||
			!element.html.includes("opencut-media://local/")
		) {
			return () => {
				cancelled = true;
			};
		}
		void nativeInvoke<string>("hf_media_resolve", {
			request: {
				projectId,
				elementId: element.id,
				html: element.html,
			},
		})
			.then((resolved) => {
				if (!cancelled) {
					setResolvedMediaHtml({
						source: element.html,
						html: preparePreviewHtml(resolved),
					});
				}
			})
			.catch((reason: unknown) => {
				if (!cancelled) {
					setError(
						reason instanceof Error
							? reason.message
							: "Could not load local AI Motion media",
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [element.html, element.id, projectId]);
	useEffect(() => {
		if (isStudio) setRuntimeMotion(null);
	}, [isStudio, preparedHtml, setRuntimeMotion]);
	const localTime = getElementLocalTime({
		timelineTime,
		elementStartTime: element.startTime,
		elementDuration: element.duration,
	});
	const resolvedTransform = resolveTransformAtTime({
		baseTransform: buildTransformFromParams({ params: element.params }),
		animations: element.animations,
		localTime,
	});
	const transform = isStudio
		? { position: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, rotate: 0 }
		: resolvedTransform;
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
	const attachIframe = useCallback(
		(node: HTMLIFrameElement | null) => {
			iframeRef.current = node;
			if (isStudio) setPreviewIframe(node);
		},
		[isStudio, setPreviewIframe],
	);

	useEffect(() => {
		if (!isStudio) return;
		postStudioPreviewAction({
			iframe: iframeRef.current,
			action: "set-editor-enabled",
			payload: { enabled: studioTool === "select" },
		});
	}, [isStudio, studioTool, preparedHtml]);

	useEffect(
		() => () => {
			if (
				isStudio &&
				useHyperframesStudioStore.getState().previewIframe === iframeRef.current
			) {
				setPreviewIframe(null);
			}
		},
		[isStudio, setPreviewIframe],
	);

	useEffect(() => {
		const syncTime = (time: number) => {
			postControl({
				iframe: iframeRef.current,
				action: "seek",
				timeSeconds: elementLocalTimeSeconds({
					element,
					timelineTime: time,
					focused: isStudio,
				}),
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
				if (isStudio) {
					postStudioPreviewAction({
						iframe: iframeRef.current,
						action: "set-editor-enabled",
						payload: {
							enabled: useHyperframesStudioStore.getState().tool === "select",
						},
					});
					const selector =
						useHyperframesStudioStore.getState().selectedLayerSelector;
					if (selector) {
						postStudioPreviewAction({
							iframe: iframeRef.current,
							action: "select-element",
							payload: { selector, announce: true },
						});
					}
				}
			} else if (event.data.type === "error") {
				setError(
					event.data.message ?? "HyperFrames preview failed to initialize.",
				);
			} else if (
				isStudio &&
				event.data.type === "motion-snapshot" &&
				event.data.motion
			) {
				const snapshot = parseStudioRuntimeMotionSnapshot(event.data.motion);
				if (snapshot) setRuntimeMotion(snapshot);
			} else if (
				isStudio &&
				(event.data.type === "element-selected" ||
					event.data.type === "element-preview-updated") &&
				event.data.element
			) {
				setPreviewSelection(event.data.element);
			} else if (isStudio && event.data.type === "element-selection-cleared") {
				setPreviewSelection(null);
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
	}, [
		editor,
		element,
		isStudio,
		selectedLayerSelector,
		setPreviewSelection,
		setRuntimeMotion,
	]);

	return (
		<div
			className={`absolute overflow-hidden ${isStudio ? "ring-primary/70 ring-1" : ""}`}
			style={{
				left,
				top,
				width: displayedWidth,
				height: displayedHeight,
				opacity: isStudio
					? 1
					: readOpacityFromParams({ params: element.params }),
				mixBlendMode: isStudio
					? "normal"
					: readBlendModeFromParams({ params: element.params }),
				transform: `translate(-50%, -50%) rotate(${transform.rotate}deg) scale(${Math.sign(transform.scaleX) || 1}, ${Math.sign(transform.scaleY) || 1})`,
			}}
		>
			<iframe
				ref={attachIframe}
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
						timeSeconds: elementLocalTimeSeconds({
							element,
							timelineTime,
							focused: isStudio,
						}),
					});
				}}
			/>
			{isStudio && (
				<div className="absolute top-2 left-2 z-50 flex gap-1 rounded-md border border-white/15 bg-black/75 p-1 shadow-lg backdrop-blur-sm">
					<button
						type="button"
						aria-label="Select and edit layers"
						aria-pressed={studioTool === "select"}
						className={`flex size-7 items-center justify-center rounded text-white transition-colors ${studioTool === "select" ? "bg-sky-500" : "hover:bg-white/10"}`}
						onClick={() => setStudioTool("select")}
					>
						<MousePointer2 className="size-3.5" />
					</button>
					<button
						type="button"
						aria-label="Interact with the composition"
						aria-pressed={studioTool === "interact"}
						className={`flex size-7 items-center justify-center rounded text-white transition-colors ${studioTool === "interact" ? "bg-sky-500" : "hover:bg-white/10"}`}
						onClick={() => setStudioTool("interact")}
					>
						<Hand className="size-3.5" />
					</button>
				</div>
			)}
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
				pointerEvents: "auto",
				zIndex: 30,
				render: ({ sceneWidth, sceneHeight }) => (
					<HyperframesPreview
						element={element}
						projectCanvasSize={projectCanvasSize}
						sceneViewportSize={{ width: sceneWidth, height: sceneHeight }}
						timelineTime={0}
						isStudio
					/>
				),
			},
		],
	};
}
