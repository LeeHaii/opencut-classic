"use client";

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useId,
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
import type { HyperframesElement, SceneTracks } from "@/timeline";
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
import { studioImageFileAsDataUrl } from "@/media/image-mime";
import {
	hasLocalHyperframesMedia,
	hyperframesPreviewMediaCacheKey,
	hyperframesPreviewSourceRevision,
	resolveCachedHyperframesPreviewMedia,
	selectHyperframesPreviewHtml,
	type ResolvedHyperframesPreviewMedia,
} from "./preview-media";
import { getHyperframesPreviewTimeSeconds } from "./preview-time";
import { PreviewSeekChannel } from "./preview-seek-channel";
import {
	findHyperframesPreviewElement,
	hyperframesPreviewPresentationKey,
	selectHyperframesTransitionElements,
} from "./preview-selection";

export {
	findHyperframesPreviewElement,
	hyperframesPreviewPresentationKey,
} from "./preview-selection";

interface PreviewMessage {
	source?: string;
	type?: string;
	message?: string;
	element?: StudioPreviewSelection;
	motion?: unknown;
	requestId?: string;
	currentTime?: number;
	previewToken?: string;
	imageId?: string;
}

interface PreviewError {
	kind: "composition" | "image-load" | "media-resolution";
	message: string;
	previewToken: string;
	imageId?: string;
}

const noActiveDrag = () => null;

interface HyperframesPreviewProps {
	element: HyperframesElement;
	projectCanvasSize: { width: number; height: number };
	sceneViewportSize: { width: number; height: number };
	timelineTime: number;
	isStudio?: boolean;
	presentationKey: string;
	onFramePresented?: (presentationKey: string) => void;
	isActive?: boolean;
	isPresented?: boolean;
}

function postControl({
	iframe,
	action,
	timeSeconds,
	requestId,
}: {
	iframe: HTMLIFrameElement | null;
	action: "play" | "pause" | "seek";
	timeSeconds?: number;
	requestId?: string;
}) {
	iframe?.contentWindow?.postMessage(
		{
			source: PARENT_MESSAGE_SOURCE,
			type: "control",
			action,
			...(timeSeconds == null ? {} : { timeSeconds }),
			...(requestId == null ? {} : { requestId }),
		},
		"*",
	);
}

function HyperframesPreview({
	element,
	projectCanvasSize,
	sceneViewportSize,
	timelineTime,
	isStudio = false,
	presentationKey,
	onFramePresented,
	isActive = true,
	isPresented,
}: HyperframesPreviewProps) {
	const editor = useEditor();
	const native = isNative();
	const previewInstanceId = useId();
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const syncTimeRef = useRef<(() => void) | null>(null);
	const transportEpochRef = useRef(0);
	const frameCallbackRef = useRef(onFramePresented);
	useLayoutEffect(() => {
		frameCallbackRef.current = onFramePresented;
	}, [onFramePresented]);
	const [hasPresentedFrame, setHasPresentedFrame] = useState(false);
	const [error, setError] = useState<PreviewError | null>(null);
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
		native &&
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
	const sourceRevision = useMemo(
		() => hyperframesPreviewSourceRevision(element.html),
		[element.html],
	);
	const previewToken = `${previewInstanceId}:${element.id}:${sourceRevision}`;
	const hasLocalMedia = hasLocalHyperframesMedia(element.html);
	const basePreparedHtml = useMemo(
		() =>
			preparePreviewHtml(element.html, {
				previewToken,
				playbackMode: "external",
			}),
		[element.html, previewToken],
	);
	const [resolvedMediaHtml, setResolvedMediaHtml] =
		useState<ResolvedHyperframesPreviewMedia | null>(null);
	const preparedHtml = selectHyperframesPreviewHtml({
		hasLocalMedia,
		basePreparedHtml,
		elementId: element.id,
		resolvedMedia: resolvedMediaHtml,
	});
	const isPreparedForCurrentSource =
		!hasLocalMedia ||
		(resolvedMediaHtml?.elementId === element.id &&
			resolvedMediaHtml.source === element.html);
	const unavailableLocalMediaError: PreviewError | null =
		hasLocalMedia && (!native || !projectId)
			? {
					kind: "media-resolution",
					message: !native
						? "Local AI Motion media is only available in the desktop app."
						: "Could not identify the project for local AI Motion media.",
					previewToken,
				}
			: null;
	const visibleError =
		unavailableLocalMediaError ??
		(error?.previewToken === previewToken ? error : null);
	useEffect(() => {
		let cancelled = false;
		if (!hasLocalMedia) {
			return () => {
				cancelled = true;
			};
		}
		if (!native || !projectId) {
			return () => {
				cancelled = true;
			};
		}

		const cacheKey = hyperframesPreviewMediaCacheKey({
			projectId,
			elementId: element.id,
			html: element.html,
		});
		void resolveCachedHyperframesPreviewMedia({
			key: cacheKey,
			resolve: () =>
				nativeInvoke<string>("hf_media_resolve", {
					request: {
						projectId,
						elementId: element.id,
						html: element.html,
					},
				}),
		})
			.then((resolved) => {
				if (!cancelled) {
					setResolvedMediaHtml({
						elementId: element.id,
						source: element.html,
						html: preparePreviewHtml(resolved, {
							previewToken,
							playbackMode: "external",
						}),
					});
					setError((current) =>
						current?.previewToken === previewToken &&
						current.kind === "media-resolution"
							? null
							: current,
					);
				}
			})
			.catch((reason: unknown) => {
				if (!cancelled) {
					setError({
						kind: "media-resolution",
						message:
							reason instanceof Error
								? reason.message
								: "Could not load local AI Motion media",
						previewToken,
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [
		element.html,
		element.id,
		hasLocalMedia,
		native,
		previewToken,
		projectId,
	]);
	useEffect(() => {
		if (isStudio) setRuntimeMotion(null);
	}, [isStudio, preparedHtml, previewToken, setRuntimeMotion]);
	const [lastActiveTime, setLastActiveTime] = useState(timelineTime);
	if (isActive && lastActiveTime !== timelineTime)
		setLastActiveTime(timelineTime);
	const localTime = getElementLocalTime({
		timelineTime: isActive ? timelineTime : lastActiveTime,
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
							dataUrl: await studioImageFileAsDataUrl({ file: asset.file }),
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

	useLayoutEffect(() => {
		const channel = new PreviewSeekChannel(
			`${previewToken}:transport-${++transportEpochRef.current}`,
		);
		let acknowledged = false;
		let lastProgress = performance.now();
		let reportedStall = false;
		const send = (request: ReturnType<PreviewSeekChannel["retry"]>) => {
			if (!request) return;
			postControl({
				iframe: iframeRef.current,
				action: "seek",
				timeSeconds: request.time,
				requestId: request.requestId,
			});
		};
		const syncTime = ({
			time,
			discontinuity = false,
		}: {
			time: number;
			discontinuity?: boolean;
		}) => {
			if (!isPreparedForCurrentSource || !isActive) return;
			const timeSeconds = getHyperframesPreviewTimeSeconds({
				startTime: element.startTime,
				duration: element.duration,
				trimStart: element.trimStart,
				sourceDuration: element.sourceDuration,
				timelineTime: isStudio
					? time
					: Math.min(time, editor.timeline.getLastFrameTime()),
				ticksPerSecond: TICKS_PER_SECOND,
				focused: isStudio,
			});
			if (timeSeconds === null) return;
			if (!channel.retry()) lastProgress = performance.now();
			send(channel.request({ time: timeSeconds, discontinuity }));
		};
		const seek = (time: number) => syncTime({ time, discontinuity: true });
		const update = (time: number) => syncTime({ time });
		const syncCurrent = () => update(editor.playback.getCurrentTime());
		syncTimeRef.current = syncCurrent;
		const handleMessage = (event: MessageEvent<PreviewMessage>) => {
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (event.data?.source !== PREVIEW_MESSAGE_SOURCE) return;
			if (event.data.previewToken !== previewToken) return;
			if (event.data.type === "ready") {
				setError((current) =>
					current?.previewToken === previewToken &&
					current.kind === "composition"
						? null
						: current,
				);
				syncCurrent();
				// An early postMessage can precede installation of the child
				// listener. Ready is the point to resend it, not wait for polling.
				send(channel.retry());
				// The editor playback manager is the only clock for this preview.
				// It advances the composition through the seek subscription below.
				postControl({ iframe: iframeRef.current, action: "pause" });
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
			} else if (event.data.type === "frame-presented") {
				const result = channel.acknowledge(event.data.requestId);
				if (result.accepted) {
					acknowledged = true;
					lastProgress = performance.now();
					reportedStall = false;
					setHasPresentedFrame(true);
					setError((current) =>
						current?.kind === "composition" ? null : current,
					);
					frameCallbackRef.current?.(presentationKey);
				}
				send(result.next);
			} else if (event.data.type === "selected-image-loaded") {
				setError((current) =>
					current?.previewToken === previewToken &&
					current.kind === "image-load" &&
					(!current.imageId || current.imageId === event.data.imageId)
						? null
						: current,
				);
			} else if (event.data.type === "selected-image-error") {
				setError({
					kind: "image-load",
					message:
						event.data.message ??
						"The selected image could not be loaded in the AI Motion preview.",
					previewToken,
					imageId: event.data.imageId,
				});
			} else if (event.data.type === "error") {
				setError({
					kind: "composition",
					message:
						event.data.message ?? "HyperFrames preview failed to initialize.",
					previewToken,
				});
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
		const unsubscribeUpdate = editor.playback.onUpdate(update);
		const unsubscribeSeek = editor.playback.onSeek(seek);
		// Lost load/ready messages and a suspended background tab must recover
		// without requiring another manual seek. Retry the SAME in-flight ID.
		const retry = () => {
			if (!isActive || document.visibilityState === "hidden") return;
			if (
				(!acknowledged || channel.retry()) &&
				!reportedStall &&
				performance.now() - lastProgress >= 10000
			) {
				reportedStall = true;
				setError({
					kind: "composition",
					previewToken,
					message:
						"AI Motion preview is not responding. Retrying; select another scene to reload it.",
				});
			}
			if (channel.retry()) send(channel.retry());
			else if (!acknowledged) syncCurrent();
		};
		const retryTimer = window.setInterval(retry, 1000);
		const resume = () => {
			lastProgress = performance.now();
			retry();
		};
		document.addEventListener("visibilitychange", resume);
		syncCurrent();
		return () => {
			syncTimeRef.current = null;
			window.clearInterval(retryTimer);
			document.removeEventListener("visibilitychange", resume);
			window.removeEventListener("message", handleMessage);
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [
		editor,
		element,
		isPreparedForCurrentSource,
		isStudio,
		isActive,
		presentationKey,
		previewToken,
		selectedLayerSelector,
		setPreviewSelection,
		setRuntimeMotion,
	]);

	const hasVisibleError = Boolean(visibleError);
	useEffect(() => {
		if (hasVisibleError && isActive)
			frameCallbackRef.current?.(presentationKey);
	}, [hasVisibleError, isActive, presentationKey]);
	// Opacity preserves rendering eligibility in isolated sandboxed iframes.
	// visibility:hidden/display:none would deadlock the child RAF handshake.
	const presented = isPresented ?? (hasPresentedFrame || Boolean(visibleError));

	return (
		<div
			className={`absolute overflow-hidden ${isStudio ? "ring-primary/70 ring-1" : ""}`}
			style={{
				left,
				top,
				width: displayedWidth,
				height: displayedHeight,
				opacity: !presented
					? 0
					: isStudio
						? 1
						: readOpacityFromParams({ params: element.params }),
				mixBlendMode: isStudio
					? "normal"
					: readBlendModeFromParams({ params: element.params }),
				transform: `translate(-50%, -50%) rotate(${transform.rotate}deg) scale(${Math.sign(transform.scaleX) || 1}, ${Math.sign(transform.scaleY) || 1})`,
				pointerEvents: presented && isActive && isStudio ? "auto" : "none",
			}}
			data-hyperframes-key={presentationKey}
			data-presented={presented ? "true" : "false"}
		>
			{preparedHtml ? (
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
						opacity: hasPresentedFrame ? 1 : 0,
					}}
					onLoad={() => syncTimeRef.current?.()}
				/>
			) : !visibleError ? (
				<div className="text-muted-foreground absolute inset-0 flex items-center justify-center bg-black/5 text-[10px]">
					Preparing AI Motion media…
				</div>
			) : null}
			{preparedHtml && (acceptsImageDrop || isReplacingImage) && (
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
			{visibleError && (
				<div className="bg-destructive/85 absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] text-white">
					{visibleError.message}
				</div>
			)}
		</div>
	);
}

export function getHyperframesPreviewOverlaySource({
	tracks,
	timelineTime,
	presentedElement,
	projectCanvasSize,
	studioElementId,
	onFramePresented,
}: {
	tracks: SceneTracks;
	timelineTime: number;
	/** Actual displayed document snapshot; retain its mount through preparation. */
	presentedElement?: HyperframesElement | null;
	projectCanvasSize: { width: number; height: number };
	/** Scene Studio focus mode: always render this element, ignoring playhead. */
	studioElementId?: string | null;
	onFramePresented?: (presentationKey: string) => void;
}): PreviewOverlaySourceResult {
	const desired = findHyperframesPreviewElement({
		tracks,
		timelineTime,
		studioElementId,
	});
	const desiredKey = desired
		? hyperframesPreviewPresentationKey(desired)
		: null;
	const presentedKey = presentedElement
		? hyperframesPreviewPresentationKey(presentedElement)
		: null;
	const activeElements = selectHyperframesTransitionElements({
		desiredElement: desired,
		presentedElement,
	});

	if (activeElements.length === 0) {
		return { definitions: [], instances: [] };
	}

	return {
		definitions: [],
		instances: activeElements.map((element, index) => {
			const presentationKey = hyperframesPreviewPresentationKey(element);
			return {
				id: `hyperframes-preview-${presentationKey}`,
				mount: { kind: "scene" },
				plane: studioElementId ? "over-interaction" : "under-interaction",
				pointerEvents:
					studioElementId && presentationKey === presentedKey ? "auto" : "none",
				zIndex: 20 + index,
				render: ({ sceneWidth, sceneHeight }) => (
					<HyperframesPreview
						key={presentationKey}
						element={element}
						projectCanvasSize={projectCanvasSize}
						sceneViewportSize={{ width: sceneWidth, height: sceneHeight }}
						timelineTime={timelineTime}
						isStudio={Boolean(studioElementId)}
						isActive={presentationKey === desiredKey}
						isPresented={
							presentedElement === undefined
								? undefined
								: presentationKey === presentedKey
						}
						presentationKey={presentationKey}
						onFramePresented={onFramePresented}
					/>
				),
			};
		}),
	};
}
