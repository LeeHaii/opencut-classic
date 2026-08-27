"use client";
/* eslint-disable opencut/prefer-object-params -- Hyperframes' public timeline callbacks are positional. */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	Timeline as HyperframesTimeline,
	usePlayerStore,
	type TimelineElement as StudioTimelineElement,
} from "@hyperframes/studio";
import { Film, Layers3 } from "lucide-react";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { Button } from "@/components/ui/button";
import { TICKS_PER_SECOND, mediaTimeFromSeconds } from "@/wasm";
import { toast } from "sonner";
import styles from "./scene-studio-timeline.module.css";
import {
	buildStudioTimelineKeyframes,
	moveStudioKeyframe,
	removeAllStudioKeyframes,
	removeStudioKeyframe,
	scaleStudioLayerAnimations,
	shiftStudioLayerAnimations,
	studioTweenPercentageForClipPercentage,
} from "../studio-animations";
import {
	applyStudioLayerPatches,
	deleteStudioLayer,
	parseStudioDocument,
	postStudioPreviewAction,
	type StudioLayer,
} from "../studio-document";
import { useHyperframesStudioStore } from "../studio-store";
import { useActiveStudioElement } from "../use-studio-element";

function layerKind(tag: string): StudioTimelineElement["kind"] {
	if (tag === "video") return "video";
	if (tag === "audio") return "audio";
	if (tag === "img" || tag === "image") return "image";
	return "element";
}

function toTimelineElement(layer: StudioLayer): StudioTimelineElement {
	return {
		id: layer.key,
		key: layer.key,
		domId: layer.id ?? undefined,
		hfId: layer.hfId ?? undefined,
		selector: layer.selector,
		label: layer.label,
		tag: layer.tag,
		kind: layerKind(layer.tag),
		start: layer.start,
		duration: layer.duration,
		sourceDuration: layer.duration,
		playbackStart: layer.playbackStart ?? undefined,
		playbackStartAttr: layer.playbackStartAttribute ?? undefined,
		track: layer.track,
		authoredTrack: layer.track,
		hidden: layer.hidden,
		timingSource: "authored",
	};
}

function layerForElement({
	layers,
	element,
}: {
	layers: StudioLayer[];
	element: StudioTimelineElement;
}): StudioLayer | null {
	return (
		layers.find((layer) => layer.key === (element.key ?? element.id)) ?? null
	);
}

const STUDIO_TIMELINE_THEME = {
	shellBackground: "var(--background)",
	shellBorder: "var(--border)",
	rulerBorder: "var(--border)",
	rowBackground: "var(--background)",
	rowBorder: "color-mix(in srgb, var(--border) 70%, transparent)",
	gutterBackground: "var(--background)",
	gutterBorder: "var(--border)",
	textPrimary: "var(--foreground)",
	textSecondary: "var(--muted-foreground)",
	tickText: "var(--muted-foreground)",
	tickMajor: "var(--border)",
	tickMinor: "color-mix(in srgb, var(--border) 55%, transparent)",
	clipBackground: "color-mix(in srgb, var(--primary) 22%, var(--background))",
	clipBackgroundActive:
		"color-mix(in srgb, var(--primary) 34%, var(--background))",
	clipBorder: "color-mix(in srgb, var(--primary) 42%, var(--border))",
	clipBorderHover: "var(--primary)",
	clipBorderActive: "var(--primary)",
	clipShadow: "none",
	clipShadowHover:
		"0 0 0 1px color-mix(in srgb, var(--primary) 28%, transparent)",
	clipShadowActive:
		"0 0 0 1px color-mix(in srgb, var(--primary) 45%, transparent)",
	clipShadowDragging: "0 8px 20px rgb(0 0 0 / 0.2)",
	handleColor: "var(--primary)",
	panelResizeSeam: "var(--border)",
	panelResizeActive: "var(--primary)",
	clipRadius: "5px",
} as const;

export function SceneStudioTimeline() {
	const { editor, located, commitHtml } = useActiveStudioElement();
	const sessionEpoch = useHyperframesStudioStore((state) => state.sessionEpoch);
	const selectedLayerKey = useHyperframesStudioStore(
		(state) => state.selectedLayerKey,
	);
	const previewIframe = useHyperframesStudioStore(
		(state) => state.previewIframe,
	);
	const runtimeMotion = useHyperframesStudioStore(
		(state) => state.runtimeMotion,
	);
	const exitStudio = useHyperframesStudioStore((state) => state.exit);
	const selectLayer = useHyperframesStudioStore((state) => state.selectLayer);
	const setActiveTab = useAssetsPanelStore((state) => state.setActiveTab);
	const html = located?.element.html ?? "";
	const document = useMemo(() => parseStudioDocument(html), [html]);
	const htmlRef = useRef(html);
	const mutationQueueRef = useRef(Promise.resolve());

	useEffect(() => {
		htmlRef.current = html;
	}, [html]);

	useEffect(() => {
		if (!located || !document) return;
		const store = usePlayerStore.getState();
		const projectId =
			editor.project.getActiveOrNull()?.metadata.id ?? "opencut-project";
		store.beginTimelineSession(
			`${projectId}:scene-studio:${located.element.id}:${sessionEpoch}`,
		);
		store.setDuration(document.duration);
		store.setElements(document.layers.map(toTimelineElement));
		const currentLayerKeys = new Set(document.layers.map((layer) => layer.key));
		const nextAnimations = new Map(store.gsapAnimations);
		const nextKeyframes = new Map(store.keyframeCache);
		for (const key of nextAnimations.keys()) {
			if (!currentLayerKeys.has(key)) nextAnimations.delete(key);
		}
		for (const key of nextKeyframes.keys()) {
			if (!currentLayerKeys.has(key)) nextKeyframes.delete(key);
		}
		for (const layer of document.layers) {
			const keyframes = buildStudioTimelineKeyframes({
				html,
				layer,
				runtimeSnapshot:
					runtimeMotion?.compositionId === document.compositionId
						? runtimeMotion
						: null,
			});
			if (keyframes?.animations.length) {
				nextAnimations.set(layer.key, keyframes.animations);
			} else {
				nextAnimations.delete(layer.key);
			}
			if (keyframes?.cache) nextKeyframes.set(layer.key, keyframes.cache);
			else nextKeyframes.delete(layer.key);
		}
		usePlayerStore.setState({
			gsapAnimations: nextAnimations,
			keyframeCache: nextKeyframes,
		});
		store.setTimelineReady(true);

		const syncTime = (time: number) => {
			const local = Math.max(
				0,
				Math.min(
					document.duration,
					(time - located.element.startTime + located.element.trimStart) /
						TICKS_PER_SECOND,
				),
			);
			store.setCurrentTime(local);
			useHyperframesStudioStore.getState().setLocalTimeSeconds(local);
		};
		const syncPlayback = () =>
			store.setIsPlaying(editor.playback.getIsPlaying());
		syncTime(editor.playback.getCurrentTime());
		syncPlayback();
		const unsubscribeUpdate = editor.playback.onUpdate(syncTime);
		const unsubscribeSeek = editor.playback.onSeek(syncTime);
		const unsubscribePlayback = editor.playback.subscribe(syncPlayback);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
			unsubscribePlayback();
		};
	}, [document, editor, html, located, runtimeMotion, sessionEpoch]);

	useEffect(() => {
		const store = usePlayerStore.getState();
		if (
			selectedLayerKey &&
			document?.layers.some((layer) => layer.key === selectedLayerKey)
		) {
			store.setSelectedElementId(selectedLayerKey);
		} else {
			store.clearSelection();
		}
	}, [document, selectedLayerKey]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			const target = event.target;
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				(target instanceof HTMLElement && target.isContentEditable)
			) {
				return;
			}
			exitStudio();
			setActiveTab("hyperframes");
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [exitStudio, setActiveTab]);

	const commitMutation = useCallback(
		(mutate: (currentHtml: string) => Promise<string>) => {
			const run = async () => {
				const currentHtml = htmlRef.current;
				const nextHtml = await mutate(currentHtml);
				if (nextHtml === currentHtml) return;
				if (commitHtml({ html: nextHtml })) htmlRef.current = nextHtml;
			};
			mutationQueueRef.current = mutationQueueRef.current
				.then(run, run)
				.catch((error: unknown) => {
					console.error("[scene-studio] Timeline edit failed", error);
					toast.error("Could not update the scene timeline");
				});
			return mutationQueueRef.current;
		},
		[commitHtml],
	);

	const moveElements = useCallback(
		async (
			edits: Array<{
				element: StudioTimelineElement;
				updates: Pick<StudioTimelineElement, "start" | "track">;
			}>,
		) => {
			if (!document) return;
			await commitMutation(async (currentHtml) => {
				let nextHtml = currentHtml;
				for (const edit of edits) {
					const layer = layerForElement({
						layers: document.layers,
						element: edit.element,
					});
					if (!layer) continue;
					nextHtml = await applyStudioLayerPatches({
						html: nextHtml,
						layer,
						operations: [
							{
								type: "attribute",
								property: "start",
								value: Math.max(0, edit.updates.start).toFixed(3),
							},
							{
								type: "attribute",
								property: "track-index",
								value: String(Math.max(0, Math.round(edit.updates.track))),
							},
						],
					});
					nextHtml = await shiftStudioLayerAnimations({
						html: nextHtml,
						layer,
						delta: Math.max(0, edit.updates.start) - layer.start,
					});
				}
				return nextHtml;
			});
		},
		[commitMutation, document],
	);

	const resizeElements = useCallback(
		async (
			changes: Array<{
				element: StudioTimelineElement;
				start: number;
				duration: number;
				playbackStart?: number;
			}>,
		) => {
			if (!document) return;
			await commitMutation(async (currentHtml) => {
				let nextHtml = currentHtml;
				for (const change of changes) {
					const layer = layerForElement({
						layers: document.layers,
						element: change.element,
					});
					if (!layer) continue;
					nextHtml = await applyStudioLayerPatches({
						html: nextHtml,
						layer,
						operations: [
							{
								type: "attribute",
								property: "start",
								value: Math.max(0, change.start).toFixed(3),
							},
							{
								type: "attribute",
								property: "duration",
								value: Math.max(0.01, change.duration).toFixed(3),
							},
							...(change.playbackStart != null
								? [
										{
											type: "attribute" as const,
											property: layer.playbackStartAttribute ?? "media-start",
											value: Math.max(0, change.playbackStart).toFixed(3),
										},
									]
								: []),
						],
					});
					nextHtml = await scaleStudioLayerAnimations({
						html: nextHtml,
						layer,
						start: Math.max(0, change.start),
						duration: Math.max(0.01, change.duration),
					});
				}
				return nextHtml;
			});
		},
		[commitMutation, document],
	);

	const editKeyframe = useCallback(
		async ({
			elementId,
			animationId,
			fromPercentage,
			toClipPercentage,
			remove = false,
		}: {
			elementId: string;
			animationId?: string;
			fromPercentage: number;
			toClipPercentage?: number;
			remove?: boolean;
		}) => {
			if (!document || !animationId || animationId.startsWith("runtime:")) {
				toast.info("Runtime-discovered motion must be edited in Source");
				return false;
			}
			const layer = document.layers.find(
				(candidate) => candidate.key === elementId,
			);
			if (!layer) return false;
			let changed = false;
			await commitMutation(async (currentHtml) => {
				const data = buildStudioTimelineKeyframes({
					html: currentHtml,
					layer,
				});
				const animation = data?.animations.find(
					(candidate) => candidate.id === animationId,
				);
				if (!animation) return currentHtml;
				const convertFlat = animation.keyframes == null;
				const nextHtml = remove
					? await removeStudioKeyframe({
							html: currentHtml,
							animationId,
							percentage: fromPercentage,
							convertFlat,
						})
					: toClipPercentage == null
						? currentHtml
						: await (async () => {
								const toPercentage = studioTweenPercentageForClipPercentage({
									animation,
									layer,
									clipPercentage: toClipPercentage,
								});
								if (toPercentage == null) return currentHtml;
								return moveStudioKeyframe({
									html: currentHtml,
									animationId,
									fromPercentage,
									toPercentage,
									convertFlat,
								});
							})();
				changed = nextHtml !== currentHtml;
				return nextHtml;
			});
			return changed;
		},
		[commitMutation, document],
	);

	if (!located || !document) {
		return (
			<div className="panel bg-background text-muted-foreground flex h-full items-center justify-center rounded-sm border text-xs">
				The AI Motion scene timeline is unavailable.
			</div>
		);
	}

	const handleSeek = (seconds: number) => {
		const localSeconds = Math.max(0, Math.min(document.duration, seconds));
		useHyperframesStudioStore.getState().setLocalTimeSeconds(localSeconds);
		const globalSeconds = Math.max(
			0,
			(located.element.startTime - located.element.trimStart) /
				TICKS_PER_SECOND +
				localSeconds,
		);
		editor.playback.seek({
			time: mediaTimeFromSeconds({ seconds: globalSeconds }),
		});
	};

	return (
		<div
			className={`${styles.root} panel bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-sm border`}
		>
			<div className="border-border/70 flex h-9 shrink-0 items-center justify-between border-b px-2.5">
				<div className="flex min-w-0 items-center gap-2">
					<div className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded">
						<Layers3 className="size-3.5" />
					</div>
					<div className="min-w-0">
						<p className="truncate text-[11px] font-medium">
							{located.element.name}
						</p>
						<p className="text-muted-foreground text-[9px]">
							Scene layers · {document.duration.toFixed(2)}s
						</p>
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-[10px]"
					onClick={() => {
						exitStudio();
						setActiveTab("hyperframes");
					}}
				>
					<Film className="size-3" />
					Project timeline
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				<HyperframesTimeline
					sessionEpoch={sessionEpoch}
					theme={STUDIO_TIMELINE_THEME}
					onSeek={handleSeek}
					onSelectElement={(element) => {
						const key = element ? (element.key ?? element.id) : null;
						const layer = key
							? document.layers.find((candidate) => candidate.key === key)
							: null;
						selectLayer({ key, selector: layer?.selector ?? null });
						postStudioPreviewAction({
							iframe: previewIframe,
							action: "select-element",
							payload: {
								selector: layer?.selector ?? null,
								announce: true,
							},
						});
					}}
					onMoveElement={(element, updates) =>
						moveElements([{ element, updates }])
					}
					onMoveElements={(edits) => moveElements(edits)}
					onResizeElement={(element, updates) =>
						resizeElements([{ element, ...updates }])
					}
					onResizeElements={(changes) => resizeElements(changes)}
					onMoveKeyframe={(elementId, keyframe, toClipPercentage) =>
						editKeyframe({
							elementId,
							animationId: keyframe.animationId,
							fromPercentage: keyframe.tweenPercentage ?? keyframe.percentage,
							toClipPercentage,
						})
					}
					onDeleteKeyframe={(elementId, keyframe) => {
						void editKeyframe({
							elementId,
							animationId: keyframe.animationId,
							fromPercentage: keyframe.tweenPercentage ?? keyframe.percentage,
							remove: true,
						});
					}}
					onMoveKeyframeToPlayhead={(element, keyframe) => {
						const layer = layerForElement({ layers: document.layers, element });
						if (!layer) return;
						const localTime =
							useHyperframesStudioStore.getState().localTimeSeconds;
						void editKeyframe({
							elementId: layer.key,
							animationId: keyframe.animationId,
							fromPercentage: keyframe.tweenPercentage ?? keyframe.percentage,
							toClipPercentage:
								((localTime - layer.start) / layer.duration) * 100,
						});
					}}
					onDeleteAllKeyframes={(element, animationId) => {
						const layer = layerForElement({ layers: document.layers, element });
						if (!layer) return;
						void commitMutation(async (currentHtml) => {
							const data = buildStudioTimelineKeyframes({
								html: currentHtml,
								layer,
							});
							const ids = animationId
								? [animationId]
								: (data?.animations.map((animation) => animation.id) ?? []);
							const flatIds = new Set(
								(data?.animations ?? [])
									.filter((animation) => animation.keyframes == null)
									.map((animation) => animation.id),
							);
							let nextHtml = currentHtml;
							for (const id of ids) {
								nextHtml = await removeAllStudioKeyframes({
									html: nextHtml,
									animationId: id,
									convertFlat: flatIds.has(id),
								});
							}
							return nextHtml;
						});
					}}
					onDeleteElement={(element) => {
						const layer = layerForElement({
							layers: document.layers,
							element,
						});
						if (!layer) return;
						selectLayer({ key: null });
						return commitMutation((currentHtml) =>
							deleteStudioLayer({ html: currentHtml, layer }),
						);
					}}
				/>
			</div>
		</div>
	);
}
