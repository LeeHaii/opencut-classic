"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
	Braces,
	Clock3,
	Diamond,
	Eye,
	EyeOff,
	Layers3,
	MousePointer2,
	Palette,
	Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils/ui";
import {
	addStudioEditableAnimation,
	addStudioKeyframe,
	convertStudioAnimationToKeyframes,
	getStudioAnimationSummary,
	getStudioLayerAnimations,
	interpolateStudioKeyframeProperties,
	moveStudioKeyframe,
	scaleStudioLayerAnimations,
	shiftStudioLayerAnimations,
	studioTweenPercentageForClipPercentage,
	updateStudioKeyframe,
	type StudioAnimationKeyframe,
} from "../studio-animations";
import {
	applyStudioLayerPatches,
	deleteStudioLayer,
	parseStudioDocument,
	patchCompositionAttribute,
	postStudioPreviewAction,
	type StudioLayer,
	type StudioPatchOperation,
	type StudioPreviewSelection,
} from "../studio-document";
import { useHyperframesStudioStore } from "../studio-store";
import { useActiveStudioElement } from "../use-studio-element";

type InspectorTab = "design" | "motion";

const STUDIO_EASES = [
	{ value: "none", label: "Linear" },
	{ value: "power1.in", label: "Ease in" },
	{ value: "power1.out", label: "Ease out" },
	{ value: "power1.inOut", label: "Ease in/out" },
	{ value: "power2.in", label: "Strong in" },
	{ value: "power2.out", label: "Strong out" },
	{ value: "power2.inOut", label: "Strong in/out" },
	{ value: "sine.inOut", label: "Smooth" },
	{ value: "expo.out", label: "Fast settle" },
	{ value: "back.out(1.4)", label: "Overshoot" },
] as const;

function layerFromPreview({
	selection,
	duration,
}: {
	selection: StudioPreviewSelection;
	duration: number;
}): StudioLayer {
	return {
		key: selection.key,
		id: selection.id,
		hfId: selection.hfId,
		selector: selection.selector,
		label: selection.label,
		tag: selection.tagName,
		text: selection.textContent,
		start: Number(selection.dataAttributes.start) || 0,
		duration: Number(selection.dataAttributes.duration) || duration,
		track: Number(selection.dataAttributes["track-index"]) || 0,
		playbackStart:
			Number(
				selection.dataAttributes["media-start"] ??
					selection.dataAttributes["playback-start"],
			) || null,
		playbackStartAttribute: selection.dataAttributes["media-start"]
			? "media-start"
			: selection.dataAttributes["playback-start"]
				? "playback-start"
				: null,
		hidden:
			selection.dataAttributes.hidden === "true" ||
			selection.dataAttributes.hidden === "1",
		styles: {},
	};
}

export function SceneStudioInspector() {
	const { located, commitHtml } = useActiveStudioElement();
	const [tab, setTab] = useState<InspectorTab>("design");
	const selectedLayerKey = useHyperframesStudioStore(
		(state) => state.selectedLayerKey,
	);
	const previewSelection = useHyperframesStudioStore(
		(state) => state.previewSelection,
	);
	const selectLayer = useHyperframesStudioStore((state) => state.selectLayer);
	const previewIframe = useHyperframesStudioStore(
		(state) => state.previewIframe,
	);
	const html = located?.element.html ?? "";
	const document = useMemo(() => parseStudioDocument(html), [html]);
	const layer = useMemo(() => {
		if (!document || !selectedLayerKey) return null;
		const timedLayer = document.layers.find(
			(candidate) => candidate.key === selectedLayerKey,
		);
		if (timedLayer) return timedLayer;
		if (previewSelection?.key === selectedLayerKey) {
			return layerFromPreview({
				selection: previewSelection,
				duration: document.duration,
			});
		}
		return null;
	}, [document, previewSelection, selectedLayerKey]);

	if (!located || !document) {
		return (
			<div className="panel bg-background text-muted-foreground flex h-full items-center justify-center rounded-sm border px-6 text-center text-xs">
				Open a valid AI Motion composition to inspect it.
			</div>
		);
	}

	const commitLayerPatch = async ({
		operation,
		previewAction,
	}: {
		operation: StudioPatchOperation;
		previewAction?: { action: string; payload: Record<string, unknown> };
	}) => {
		if (!layer) return;
		let nextHtml = await applyStudioLayerPatches({
			html: located.element.html,
			layer,
			operations: [operation],
		});
		if (operation.type === "attribute" && operation.property === "start") {
			const start = Math.max(0, Number(operation.value));
			if (Number.isFinite(start)) {
				nextHtml = await shiftStudioLayerAnimations({
					html: nextHtml,
					layer,
					delta: start - layer.start,
				});
			}
		} else if (
			operation.type === "attribute" &&
			operation.property === "duration"
		) {
			const duration = Math.max(0.01, Number(operation.value));
			if (Number.isFinite(duration)) {
				nextHtml = await scaleStudioLayerAnimations({
					html: nextHtml,
					layer,
					start: layer.start,
					duration,
				});
			}
		}
		if (nextHtml === located.element.html) return;
		commitHtml({ html: nextHtml });
		if (previewAction) {
			postStudioPreviewAction({
				iframe: previewIframe,
				action: previewAction.action,
				payload: previewAction.payload,
			});
		}
	};

	return (
		<div className="panel bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-sm border">
			<div className="border-border/70 flex h-10 shrink-0 items-center gap-2 border-b px-3">
				<div className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded">
					{layer ? (
						<MousePointer2 className="size-3.5" />
					) : (
						<Layers3 className="size-3.5" />
					)}
				</div>
				<div className="min-w-0">
					<p className="truncate text-[11px] font-semibold">
						{layer?.label ?? "Composition"}
					</p>
					<p className="text-muted-foreground truncate font-mono text-[9px]">
						{layer ? layer.selector : document.compositionId}
					</p>
				</div>
			</div>

			{layer && (
				<div className="border-border/70 grid shrink-0 grid-cols-2 border-b p-1">
					<TabButton
						active={tab === "design"}
						icon={<Palette className="size-3.5" />}
						label="Design"
						onClick={() => setTab("design")}
					/>
					<TabButton
						active={tab === "motion"}
						icon={<Diamond className="size-3.5" />}
						label="Motion"
						onClick={() => setTab("motion")}
					/>
				</div>
			)}

			<div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
				{!layer ? (
					<CompositionInspector
						document={document}
						html={located.element.html}
						onCommit={(nextHtml) =>
							commitHtml({
								html: nextHtml,
								syncCompositionMetadata: true,
							})
						}
					/>
				) : tab === "design" ? (
					<DesignInspector
						layer={layer}
						previewSelection={previewSelection}
						previewIframe={previewIframe}
						onCommit={commitLayerPatch}
						onDelete={async () => {
							const nextHtml = await deleteStudioLayer({
								html: located.element.html,
								layer,
							});
							if (nextHtml !== located.element.html) {
								commitHtml({ html: nextHtml });
								selectLayer({ key: null });
							}
						}}
					/>
				) : (
					<MotionInspector
						html={located.element.html}
						layer={layer}
						compositionId={document.compositionId}
						onCommit={(nextHtml) => commitHtml({ html: nextHtml })}
					/>
				)}
			</div>
		</div>
	);
}

function TabButton({
	active,
	icon,
	label,
	onClick,
}: {
	active: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={cn(
				"flex h-7 items-center justify-center gap-1.5 rounded text-[11px] font-medium",
				active
					? "bg-secondary text-secondary-foreground"
					: "text-muted-foreground hover:bg-accent hover:text-foreground",
			)}
			onClick={onClick}
		>
			{icon}
			{label}
		</button>
	);
}

function Section({
	title,
	icon,
	children,
}: {
	title: string;
	icon?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="border-border/60 border-b p-3">
			<h3 className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
				<span className="text-muted-foreground">{icon}</span>
				{title}
			</h3>
			<div className="space-y-2">{children}</div>
		</section>
	);
}

function PropertyField({
	label,
	value,
	type = "text",
	step,
	min,
	onPreview,
	onCommit,
}: {
	label: string;
	value: string;
	type?: "text" | "number";
	step?: number;
	min?: number;
	onPreview?: (value: string) => void;
	onCommit: (value: string) => void;
}) {
	const [edit, setEdit] = useState<{
		sourceValue: string;
		draft: string;
	} | null>(null);
	const displayedValue = edit?.sourceValue === value ? edit.draft : value;
	const commit = () => {
		if (displayedValue !== value) onCommit(displayedValue);
		else setEdit(null);
	};
	return (
		<label className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-2">
			<span className="text-muted-foreground text-[10px]">{label}</span>
			<Input
				size="xs"
				type={type}
				step={step}
				min={min}
				value={displayedValue}
				onChange={(event) => {
					setEdit({ sourceValue: value, draft: event.target.value });
					onPreview?.(event.target.value);
				}}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
					if (event.key === "Escape") {
						setEdit(null);
						event.currentTarget.blur();
					}
				}}
			/>
		</label>
	);
}

function CompositionInspector({
	document,
	html,
	onCommit,
}: {
	document: NonNullable<ReturnType<typeof parseStudioDocument>>;
	html: string;
	onCommit: (html: string) => void;
}) {
	const commitAttribute = ({
		attribute,
		value,
	}: {
		attribute: "duration" | "width" | "height";
		value: string;
	}) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric) || numeric <= 0) return;
		onCommit(
			patchCompositionAttribute({
				html,
				attribute,
				value:
					attribute === "duration"
						? numeric.toFixed(3)
						: String(Math.round(numeric)),
			}),
		);
	};

	return (
		<>
			<Section title="Canvas" icon={<Layers3 className="size-3" />}>
				<PropertyField
					label="Width"
					type="number"
					min={1}
					value={String(document.width)}
					onCommit={(value) => commitAttribute({ attribute: "width", value })}
				/>
				<PropertyField
					label="Height"
					type="number"
					min={1}
					value={String(document.height)}
					onCommit={(value) => commitAttribute({ attribute: "height", value })}
				/>
				<PropertyField
					label="Duration"
					type="number"
					step={0.1}
					min={0.01}
					value={document.duration.toFixed(2)}
					onCommit={(value) =>
						commitAttribute({ attribute: "duration", value })
					}
				/>
			</Section>
			<div className="text-muted-foreground px-5 py-8 text-center text-[11px] leading-relaxed">
				<MousePointer2 className="mx-auto mb-2 size-5 opacity-50" />
				Select a layer in the preview, layer list, or scene timeline to edit its
				properties.
			</div>
		</>
	);
}

function DesignInspector({
	layer,
	previewSelection,
	previewIframe,
	onCommit,
	onDelete,
}: {
	layer: StudioLayer;
	previewSelection: StudioPreviewSelection | null;
	previewIframe: HTMLIFrameElement | null;
	onCommit: (args: {
		operation: StudioPatchOperation;
		previewAction?: { action: string; payload: Record<string, unknown> };
	}) => Promise<void>;
	onDelete: () => Promise<void>;
}) {
	const canEditText =
		/^(a|button|em|h[1-6]|label|li|p|small|span|strong)$/i.test(layer.tag);
	const isCompositionRoot =
		previewSelection?.key === layer.key &&
		Boolean(previewSelection.dataAttributes["composition-id"]);
	const computed =
		previewSelection?.key === layer.key ? previewSelection.computedStyles : {};
	const valueFor = ({
		property,
		fallback = "",
	}: {
		property: string;
		fallback?: string;
	}) => layer.styles[property] ?? computed[property] ?? fallback;
	const liveStyle = ({
		property,
		value,
	}: {
		property: string;
		value: string;
	}) =>
		postStudioPreviewAction({
			iframe: previewIframe,
			action: "patch-style",
			payload: { selector: layer.selector, property, value },
		});
	const commitStyle = ({
		property,
		value,
	}: {
		property: string;
		value: string;
	}) =>
		onCommit({
			operation: {
				type: "inline-style",
				property,
				value: value.trim() || null,
			},
			previewAction: {
				action: "patch-style",
				payload: { selector: layer.selector, property, value },
			},
		});
	const commitData = ({
		property,
		value,
	}: {
		property: string;
		value: string;
	}) =>
		onCommit({
			operation: { type: "attribute", property, value },
			previewAction: {
				action: "patch-attribute",
				payload: { selector: layer.selector, property, value },
			},
		});

	return (
		<>
			<Section title="Layer" icon={<Layers3 className="size-3" />}>
				<div className="bg-muted/30 flex items-center justify-between rounded-md px-2 py-1.5">
					<div className="min-w-0">
						<p className="truncate text-[11px] font-medium">{layer.label}</p>
						<p className="text-muted-foreground font-mono text-[9px]">
							{layer.tag}
						</p>
					</div>
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={() =>
							void commitData({
								property: "hidden",
								value: layer.hidden ? "false" : "true",
							})
						}
						aria-label={layer.hidden ? "Show layer" : "Hide layer"}
					>
						{layer.hidden ? (
							<EyeOff className="size-3.5" />
						) : (
							<Eye className="size-3.5" />
						)}
					</Button>
				</div>
				{canEditText && (
					<PropertyField
						label="Text"
						value={layer.text}
						onPreview={(value) =>
							postStudioPreviewAction({
								iframe: previewIframe,
								action: "patch-text",
								payload: { selector: layer.selector, value },
							})
						}
						onCommit={(value) =>
							void onCommit({
								operation: {
									type: "text-content",
									property: "textContent",
									value,
								},
								previewAction: {
									action: "patch-text",
									payload: { selector: layer.selector, value },
								},
							})
						}
					/>
				)}
			</Section>

			<Section title="Timing" icon={<Clock3 className="size-3" />}>
				<PropertyField
					label="Start"
					type="number"
					step={0.05}
					min={0}
					value={layer.start.toFixed(3)}
					onCommit={(value) => void commitData({ property: "start", value })}
				/>
				<PropertyField
					label="Duration"
					type="number"
					step={0.05}
					min={0.01}
					value={layer.duration.toFixed(3)}
					onCommit={(value) => void commitData({ property: "duration", value })}
				/>
				<PropertyField
					label="Track"
					type="number"
					step={1}
					min={0}
					value={String(layer.track)}
					onCommit={(value) =>
						void commitData({ property: "track-index", value })
					}
				/>
			</Section>

			<Section title="Layout" icon={<Braces className="size-3" />}>
				{[
					["Left", "left", "auto"],
					["Top", "top", "auto"],
					["Width", "width", "auto"],
					["Height", "height", "auto"],
				].map(([label, property, fallback]) => (
					<PropertyField
						key={property}
						label={label}
						value={valueFor({ property, fallback })}
						onPreview={(value) => liveStyle({ property, value })}
						onCommit={(value) => void commitStyle({ property, value })}
					/>
				))}
			</Section>

			<Section title="Appearance" icon={<Palette className="size-3" />}>
				{[
					["Opacity", "opacity", "1"],
					["Color", "color", ""],
					["Background", "background-color", "transparent"],
					["Radius", "border-radius", "0px"],
					["Font size", "font-size", ""],
					["Font weight", "font-weight", ""],
				].map(([label, property, fallback]) => (
					<PropertyField
						key={property}
						label={label}
						value={valueFor({ property, fallback })}
						onPreview={(value) => liveStyle({ property, value })}
						onCommit={(value) => void commitStyle({ property, value })}
					/>
				))}
			</Section>

			{!isCompositionRoot && (
				<div className="p-3">
					<Button
						variant="outline"
						size="sm"
						className="text-destructive hover:text-destructive w-full"
						onClick={() => void onDelete()}
					>
						<Trash2 className="size-3.5" />
						Delete layer
					</Button>
				</div>
			)}
		</>
	);
}

function MotionInspector({
	html,
	layer,
	compositionId,
	onCommit,
}: {
	html: string;
	layer: StudioLayer;
	compositionId: string;
	onCommit: (html: string) => void;
}) {
	const runtimeMotion = useHyperframesStudioStore(
		(state) => state.runtimeMotion,
	);
	const localTimeSeconds = useHyperframesStudioStore(
		(state) => state.localTimeSeconds,
	);
	const animationData = useMemo(
		() =>
			getStudioLayerAnimations({
				html,
				layer,
				runtimeSnapshot:
					runtimeMotion?.compositionId === compositionId ? runtimeMotion : null,
			}),
		[compositionId, html, layer, runtimeMotion],
	);
	if (
		animationData.animations.length === 0 &&
		animationData.runtimeAnimations.length === 0
	) {
		return (
			<div className="text-muted-foreground px-5 py-10 text-center text-[11px] leading-relaxed">
				<Diamond className="mx-auto mb-2 size-5 opacity-50" />
				This layer has no GSAP motion. Add a tween in Source and its timing will
				appear here and on the scene timeline.
			</div>
		);
	}

	return (
		<>
			<Section title="Animations" icon={<Diamond className="size-3" />}>
				{animationData.animations.map((animation) => {
					const summary = getStudioAnimationSummary(animation);
					const animationKeyframes = animationData.keyframes.filter(
						(keyframe) => keyframe.animationId === animation.id,
					);
					const clipPercentage =
						((localTimeSeconds - layer.start) / layer.duration) * 100;
					const playheadPercentage = studioTweenPercentageForClipPercentage({
						animation,
						layer,
						clipPercentage,
					});
					const hasKeyAtPlayhead =
						playheadPercentage != null &&
						animationKeyframes.some(
							(keyframe) =>
								Math.abs(keyframe.percentage - playheadPercentage) < 0.01,
						);
					return (
						<div
							key={animation.id}
							className="bg-muted/30 rounded-md px-2.5 py-2"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="truncate text-[11px] font-medium capitalize">
									{animation.propertyGroup ?? animation.method}
								</span>
								<span className="text-muted-foreground text-[9px]">
									{summary.keyframeCount} keys
								</span>
							</div>
							<div className="mt-1 flex items-center justify-between gap-2">
								<p className="text-muted-foreground font-mono text-[9px]">
									{summary.start.toFixed(2)}s · {summary.duration.toFixed(2)}s
								</p>
								<div className="flex items-center gap-1">
									{playheadPercentage != null && (
										<Button
											variant="ghost"
											size="sm"
											className="h-6 px-2 text-[9px]"
											disabled={hasKeyAtPlayhead}
											onClick={() =>
												void addStudioKeyframe({
													html,
													animationId: animation.id,
													percentage: playheadPercentage,
													properties: interpolateStudioKeyframeProperties({
														keyframes: animationKeyframes,
														percentage: playheadPercentage,
													}),
													convertFlat: animation.keyframes == null,
												}).then(onCommit)
											}
										>
											{hasKeyAtPlayhead ? "Key at playhead" : "Add key"}
										</Button>
									)}
									{!animation.keyframes && summary.keyframeCount > 0 && (
										<Button
											variant="ghost"
											size="sm"
											className="h-6 px-2 text-[9px]"
											onClick={() =>
												void convertStudioAnimationToKeyframes({
													html,
													animationId: animation.id,
												}).then(onCommit)
											}
										>
											Make editable
										</Button>
									)}
								</div>
							</div>
						</div>
					);
				})}
				{animationData.runtimeAnimations.map((animation) => (
					<div
						key={animation.id}
						className="border-border/60 bg-muted/20 rounded-md border px-2.5 py-2"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="truncate text-[11px] font-medium capitalize">
								{animation.propertyGroup}
							</span>
							<span className="text-muted-foreground text-[9px]">
								Generated · read only
							</span>
						</div>
						<div className="mt-1 flex items-center justify-between gap-2">
							<p className="text-muted-foreground font-mono text-[9px]">
								{animation.start.toFixed(2)}s · {animation.duration.toFixed(2)}s
							</p>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-[9px]"
								disabled={animation.keyframes.length < 2}
								onClick={() =>
									void addStudioEditableAnimation({
										html,
										layer,
										animation,
									}).then(onCommit)
								}
							>
								Create editable copy
							</Button>
						</div>
					</div>
				))}
			</Section>

			{animationData.diagnostics.map((diagnostic) => (
				<p
					key={`${diagnostic.kind}:${diagnostic.message}`}
					className="border-border/60 bg-muted/20 text-muted-foreground mx-3 mt-3 rounded-md border px-2.5 py-2 text-[10px] leading-relaxed"
				>
					{diagnostic.message}
				</p>
			))}

			<Section title="Keyframes" icon={<Clock3 className="size-3" />}>
				{animationData.keyframes.length === 0 ? (
					<p className="text-muted-foreground text-[10px]">
						No interpolated keyframes were discovered for this animation.
					</p>
				) : (
					animationData.keyframes.map((keyframe) => (
						<KeyframeEditor
							key={`${keyframe.animationId}:${keyframe.percentage}`}
							html={html}
							keyframe={keyframe}
							hasPreviousKeyframe={animationData.keyframes.some(
								(candidate) =>
									candidate.animationId === keyframe.animationId &&
									candidate.percentage < keyframe.percentage,
							)}
							onCommit={onCommit}
						/>
					))
				)}
			</Section>
		</>
	);
}

function KeyframeEditor({
	html,
	keyframe,
	hasPreviousKeyframe,
	onCommit,
}: {
	html: string;
	keyframe: StudioAnimationKeyframe;
	hasPreviousKeyframe: boolean;
	onCommit: (html: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const hasListedEase = STUDIO_EASES.some(
		(option) => option.value === keyframe.ease,
	);
	return (
		<div className="bg-muted/30 overflow-hidden rounded-md">
			<div className="flex items-center gap-1.5 px-2 py-1.5">
				<button
					type="button"
					className="min-w-0 flex-1 text-left"
					onClick={() => setExpanded((value) => !value)}
				>
					<p className="truncate text-[10px] font-medium capitalize">
						{keyframe.propertyGroup}
					</p>
					<p className="text-muted-foreground font-mono text-[9px]">
						{keyframe.clipPercentage.toFixed(1)}% of clip
					</p>
				</button>
				<Input
					size="xs"
					type="number"
					min={0}
					max={100}
					step={1}
					defaultValue={keyframe.percentage.toFixed(1)}
					disabled={keyframe.editability === "source"}
					className="w-16 px-2 font-mono text-[9px]"
					onBlur={(event) => {
						const nextPercentage = Number(event.currentTarget.value);
						if (
							!Number.isFinite(nextPercentage) ||
							nextPercentage === keyframe.percentage
						) {
							return;
						}
						void moveStudioKeyframe({
							html,
							animationId: keyframe.animationId,
							fromPercentage: keyframe.percentage,
							toPercentage: Math.max(0, Math.min(100, nextPercentage)),
							convertFlat: keyframe.synthesized,
						}).then(onCommit);
					}}
				/>
				<span className="text-muted-foreground text-[9px]">%</span>
			</div>
			{expanded && (
				<div className="border-border/50 space-y-1.5 border-t px-2 py-2">
					{keyframe.editability !== "source" && hasPreviousKeyframe && (
						<div className="flex items-center justify-between gap-2">
							<span className="text-muted-foreground text-[10px]">
								Curve from previous
							</span>
							<Select
								value={keyframe.ease ?? "none"}
								onValueChange={(ease) =>
									void updateStudioKeyframe({
										html,
										animationId: keyframe.animationId,
										percentage: keyframe.percentage,
										properties: keyframe.properties,
										ease: ease === "none" ? undefined : ease,
										convertFlat: keyframe.synthesized,
									}).then(onCommit)
								}
							>
								<SelectTrigger size="sm" className="h-7 w-32 text-[10px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{keyframe.ease && !hasListedEase && (
										<SelectItem value={keyframe.ease}>
											{keyframe.ease}
										</SelectItem>
									)}
									{STUDIO_EASES.map((ease) => (
										<SelectItem key={ease.value} value={ease.value}>
											{ease.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					{Object.entries(keyframe.properties).map(([property, value]) =>
						keyframe.editability === "source" ? (
							<div
								key={property}
								className="flex items-center justify-between gap-2 text-[10px]"
							>
								<span className="text-muted-foreground">{property}</span>
								<span className="truncate font-mono">{String(value)}</span>
							</div>
						) : (
							<PropertyField
								key={property}
								label={property}
								value={String(value)}
								onCommit={(nextValue) => {
									const parsed = Number(nextValue);
									const nextProperties = {
										...keyframe.properties,
										[property]: Number.isFinite(parsed) ? parsed : nextValue,
									};
									void updateStudioKeyframe({
										html,
										animationId: keyframe.animationId,
										percentage: keyframe.percentage,
										properties: nextProperties,
										ease: keyframe.ease,
										convertFlat: keyframe.synthesized,
									}).then(onCommit);
								}}
							/>
						),
					)}
				</div>
			)}
		</div>
	);
}
