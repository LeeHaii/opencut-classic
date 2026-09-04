"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	PARENT_MESSAGE_SOURCE,
	PREVIEW_MESSAGE_SOURCE,
	isNative,
	nativeInvoke,
	preparePreviewHtml,
	quickValidate,
	type StudioImageReplaceResult,
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
import { toast } from "sonner";
import { getHyperframesPreviewLayout } from "./preview-layout";
import {
	applyStudioLayerPatches,
	postStudioPreviewAction,
	studioLayerFromPreviewSelection,
	type StudioPreviewSelection,
} from "./studio-document";
import { parseStudioRuntimeMotionSnapshot } from "./studio-animations";
import { useHyperframesStudioStore } from "./studio-store";
import { findStudioElement } from "./use-studio-element";

interface PreviewMessage {
	source?: string;
	type?: string;
	message?: string;
	element?: StudioPreviewSelection;
	motion?: unknown;
	requestId?: string;
}

const noActiveDrag = () => null;

function fileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () =>
			typeof reader.result === "string"
				? resolve(reader.result)
				: reject(new Error("Could not read the dropped image"));
		reader.onerror = () =>
			reject(reader.error ?? new Error("Could not read image"));
		reader.readAsDataURL(file);
	});
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
	const [isReplacingImage, setIsReplacingImage] = useState(false);
	const subscribeDrag = useCallback(
		(listener: () => void) => editor.timeline.dragSource.subscribe(listener),
		[editor],
	);
	const getActiveDrag = useCallback(
		() => editor.timeline.dragSource.getActive(),
		[editor],
	);
	const activeDrag = useSyncExternalStore(
		subscribeDrag,
		getActiveDrag,
		noActiveDrag,
	);
	const acceptsImageDrop =
		isStudio &&
		isNative() &&
		activeDrag?.type === "media" &&
		activeDrag.mediaType === "image";
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

	const resolveMediaDropTarget = useCallback(
		({ clientX, clientY }: { clientX: number; clientY: number }) => {
			const iframe = iframeRef.current;
			if (!iframe) return Promise.resolve<StudioPreviewSelection | null>(null);
			const rect = iframe.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				return Promise.resolve<StudioPreviewSelection | null>(null);
			}
			const requestId = `media-drop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			return new Promise<StudioPreviewSelection | null>((resolve) => {
				const timeout = window.setTimeout(() => {
					window.removeEventListener("message", onMessage);
					resolve(null);
				}, 1500);
				const onMessage = (event: MessageEvent<PreviewMessage>) => {
					if (
						event.source !== iframe.contentWindow ||
						event.data?.source !== PREVIEW_MESSAGE_SOURCE ||
						event.data.requestId !== requestId ||
						(event.data.type !== "media-drop-target" &&
							event.data.type !== "media-drop-target-cleared")
					) {
						return;
					}
					window.clearTimeout(timeout);
					window.removeEventListener("message", onMessage);
					resolve(event.data.element ?? null);
				};
				window.addEventListener("message", onMessage);
				postStudioPreviewAction({
					iframe,
					action: "resolve-media-drop-target",
					payload: {
						requestId,
						x: ((clientX - rect.left) * element.width) / rect.width,
						y: ((clientY - rect.top) * element.height) / rect.height,
					},
				});
			});
		},
		[element.height, element.width],
	);

	const handleImageDrop = useCallback(
		async ({ clientX, clientY }: { clientX: number; clientY: number }) => {
			if (isReplacingImage || !projectId) return;
			const dragResolution = editor.timeline.dragSource.resolveForDrop();
			if (!dragResolution) return;
			setIsReplacingImage(true);
			try {
				const [target, dragData] = await Promise.all([
					resolveMediaDropTarget({ clientX, clientY }),
					Promise.resolve(dragResolution),
				]);
				if (!target) {
					throw new Error(
						"Drop the image directly over an image or SVG element",
					);
				}
				if (dragData.type !== "media" || dragData.mediaType !== "image") {
					throw new Error("Only images can replace preview artwork");
				}
				let asset = editor.media
					.getAssets()
					.find((item) => item.id === dragData.id);
				if (!asset) throw new Error("The dropped media asset was not found");
				if (asset.remoteUrl && !asset.file) {
					const downloaded = await editor.media.downloadRemoteAsset({
						projectId,
						id: asset.id,
					});
					if (!downloaded)
						throw new Error("Could not download the dropped image");
					asset = downloaded;
				}
				if (!asset?.file || asset.type !== "image") {
					throw new Error("The dropped image is not available as a local file");
				}

				let sourceHtml = element.html;
				let stableTarget = target;
				if (!stableTarget.id && !stableTarget.hfId) {
					const hfId = `media-target-${crypto.randomUUID()}`;
					const info = quickValidate(sourceHtml);
					if (!info) throw new Error("The AI Motion source is not valid");
					const layer = studioLayerFromPreviewSelection({
						selection: stableTarget,
						duration: info.durationSecs,
					});
					sourceHtml = await applyStudioLayerPatches({
						html: sourceHtml,
						layer,
						operations: [
							{
								type: "html-attribute",
								property: "data-hf-id",
								value: hfId,
							},
						],
					});
					stableTarget = {
						...stableTarget,
						key: hfId,
						hfId,
						selector: `[data-hf-id="${hfId}"]`,
					};
				}

				const result = await nativeInvoke<StudioImageReplaceResult>(
					"hf_studio_replace_image",
					{
						request: {
							projectId,
							elementId: element.id,
							html: sourceHtml,
							target: { id: stableTarget.id, hfId: stableTarget.hfId },
							dataUrl: await fileAsDataUrl(asset.file),
							name: asset.name,
							fit: "contain",
						},
					},
				);
				const located = findStudioElement({
					tracks: editor.scenes.getActiveSceneOrNull()?.tracks ?? null,
					elementId: element.id,
				});
				if (!located || located.element.html !== element.html) {
					throw new Error(
						"The scene changed while the image was being prepared; drop it again",
					);
				}
				editor.timeline.updateElements({
					updates: [
						{
							trackId: located.trackId,
							elementId: located.element.id,
							patch: {
								html: result.html,
								renderedMediaId: undefined,
								renderHash: undefined,
							},
						},
					],
				});
				setPreviewSelection(stableTarget);
				toast.success(`Replaced ${stableTarget.label} with ${asset.name}`);
				for (const warning of result.warnings) toast.warning(warning);
			} catch (reason) {
				toast.error("Could not replace this element", {
					description:
						reason instanceof Error ? reason.message : String(reason),
				});
			} finally {
				setIsReplacingImage(false);
				postStudioPreviewAction({
					iframe: iframeRef.current,
					action: "clear-media-drop-target",
				});
			}
		},
		[
			editor,
			element.html,
			element.id,
			isReplacingImage,
			projectId,
			resolveMediaDropTarget,
			setPreviewSelection,
		],
	);

	useEffect(() => {
		if (!isStudio) return;
		postStudioPreviewAction({
			iframe: iframeRef.current,
			action: "set-editor-enabled",
			payload: { enabled: studioTool === "select" },
		});
	}, [isStudio, studioTool, preparedHtml]);

	useEffect(() => {
		if (acceptsImageDrop || isReplacingImage) return;
		postStudioPreviewAction({
			iframe: iframeRef.current,
			action: "clear-media-drop-target",
		});
	}, [acceptsImageDrop, isReplacingImage]);

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
			} else if (event.data.type === "selected-image-loaded") {
				setError(null);
			} else if (event.data.type === "selected-image-error") {
				setError(
					event.data.message ??
						"The selected image could not be loaded in the AI Motion preview.",
				);
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
			{(acceptsImageDrop || isReplacingImage) && (
				<div
					className="absolute inset-0 z-40 cursor-copy"
					onDragOver={(event) => {
						event.preventDefault();
						event.dataTransfer.dropEffect = "copy";
						const rect = iframeRef.current?.getBoundingClientRect();
						if (!rect || rect.width <= 0 || rect.height <= 0) return;
						postStudioPreviewAction({
							iframe: iframeRef.current,
							action: "resolve-media-drop-target",
							payload: {
								requestId: "media-drop-hover",
								x: ((event.clientX - rect.left) * element.width) / rect.width,
								y: ((event.clientY - rect.top) * element.height) / rect.height,
							},
						});
					}}
					onDragLeave={(event) => {
						if (
							event.relatedTarget instanceof Node &&
							event.currentTarget.contains(event.relatedTarget)
						) {
							return;
						}
						postStudioPreviewAction({
							iframe: iframeRef.current,
							action: "clear-media-drop-target",
						});
					}}
					onDrop={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void handleImageDrop({
							clientX: event.clientX,
							clientY: event.clientY,
						});
					}}
				>
					<div className="absolute top-2 right-2 rounded bg-emerald-600/95 px-2 py-1 text-[10px] font-medium text-white shadow">
						{isReplacingImage
							? "Applying image…"
							: "Drop on an image or SVG to replace it"}
					</div>
				</div>
			)}
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
