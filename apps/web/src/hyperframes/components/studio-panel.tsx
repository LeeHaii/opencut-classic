"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
	Braces,
	ChevronRight,
	CircleDot,
	ExternalLink,
	Eye,
	EyeOff,
	Film,
	Layers3,
	LogOut,
	MousePointer2,
	RefreshCw,
} from "lucide-react";
import { quickValidate, isNative, nativeInvoke } from "@opencut/hyperframes";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/ui";
import { toast } from "sonner";
import {
	applyStudioLayerPatches,
	parseStudioDocument,
	postStudioPreviewAction,
	type StudioLayer,
} from "../studio-document";
import { useHyperframesStudioStore } from "../studio-store";
import { useActiveStudioElement } from "../use-studio-element";

const HyperframesSourceEditor = dynamic(
	async () => {
		const studio = await import("@hyperframes/studio");
		return studio.SourceEditor;
	},
	{
		ssr: false,
		loading: () => (
			<div className="text-muted-foreground flex h-full items-center justify-center text-xs">
				Loading source editor…
			</div>
		),
	},
);

export function StudioPanelView() {
	const { located } = useActiveStudioElement();
	const exitStudio = useHyperframesStudioStore((state) => state.exit);
	const hideStudioTab = useAssetsPanelStore((state) => state.hideStudioTab);

	if (!located) {
		return (
			<PanelView title="Scene Studio" contentClassName="h-full">
				<div className="text-muted-foreground flex flex-col gap-2 px-1 py-6 text-xs">
					<p>Open an AI Motion scene to edit its layers visually.</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							exitStudio();
							hideStudioTab();
						}}
					>
						Go to AI Motion
					</Button>
				</div>
			</PanelView>
		);
	}

	return (
		<StudioEditor
			key={located.element.id}
			onExit={() => {
				exitStudio();
				hideStudioTab();
			}}
		/>
	);
}

function StudioEditor({ onExit }: { onExit: () => void }) {
	const { editor, located, commitHtml, updateElement } =
		useActiveStudioElement();
	const setActiveTab = useAssetsPanelStore((state) => state.setActiveTab);
	const workspaceView = useHyperframesStudioStore(
		(state) => state.workspaceView,
	);
	const setWorkspaceView = useHyperframesStudioStore(
		(state) => state.setWorkspaceView,
	);
	const [name, setName] = useState(located?.element.name ?? "");

	if (!located) return null;
	const { element } = located;

	const commitName = () => {
		const trimmed = name.trim();
		if (!trimmed || trimmed === element.name) return;
		updateElement({ name: trimmed });
	};

	const handleRender = async () => {
		if (!isNative()) {
			toast.info("MP4 rendering needs the desktop app");
			return;
		}
		try {
			await nativeInvoke("hf_render", {
				request: {
					jobId: `studio-${element.id}-${Date.now()}`,
					projectId: editor.project.getActiveOrNull()?.metadata.id ?? "",
					elementId: element.id,
					html: element.html,
				},
			});
			toast.info("Render started — progress is available in AI Motion");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Render failed to start",
			);
		}
	};

	return (
		<PanelView
			title="Scene Studio"
			actions={
				<Button variant="ghost" size="sm" onClick={onExit}>
					<LogOut className="size-3.5" />
					Exit
				</Button>
			}
			contentClassName="h-full !p-0"
		>
			<div className="flex h-full min-h-0 flex-col">
				<div className="border-border/60 space-y-2 border-b px-3 py-2.5">
					<div className="text-muted-foreground flex min-w-0 items-center gap-1 text-[10px]">
						<span className="truncate">Project</span>
						<ChevronRight className="size-3 shrink-0" />
						<span className="text-foreground truncate font-medium">
							{element.name}
						</span>
					</div>
					<Input
						size="xs"
						value={name}
						maxLength={80}
						onChange={(event) => setName(event.target.value)}
						onBlur={commitName}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
						}}
					/>
				</div>

				<div className="border-border/60 grid grid-cols-2 border-b p-1">
					<WorkspaceButton
						active={workspaceView === "layers"}
						icon={<Layers3 className="size-3.5" />}
						label="Layers"
						onClick={() => setWorkspaceView("layers")}
					/>
					<WorkspaceButton
						active={workspaceView === "source"}
						icon={<Braces className="size-3.5" />}
						label="Source"
						onClick={() => setWorkspaceView("source")}
					/>
				</div>

				<div className="min-h-0 flex-1">
					{workspaceView === "layers" ? (
						<LayersWorkspace html={element.html} onCommit={commitHtml} />
					) : (
						<SourceWorkspace
							html={element.html}
							onCommit={(html) =>
								commitHtml({ html, syncCompositionMetadata: true })
							}
						/>
					)}
				</div>

				<div className="border-border/60 grid grid-cols-2 gap-1.5 border-t p-2">
					<Button
						variant="outline"
						size="sm"
						className="h-8 text-[11px]"
						onClick={() => setActiveTab("hyperframes")}
					>
						<ExternalLink className="size-3.5" />
						AI chat
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-8 text-[11px]"
						onClick={() => void handleRender()}
					>
						<Film className="size-3.5" />
						Render
					</Button>
				</div>
			</div>
		</PanelView>
	);
}

function WorkspaceButton({
	active,
	icon,
	label,
	onClick,
}: {
	active: boolean;
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={cn(
				"flex h-7 items-center justify-center gap-1.5 rounded text-[11px] font-medium transition-colors",
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

function LayersWorkspace({
	html,
	onCommit,
}: {
	html: string;
	onCommit: (args: { html: string }) => boolean;
}) {
	const document = useMemo(() => parseStudioDocument(html), [html]);
	const selectedLayerKey = useHyperframesStudioStore(
		(state) => state.selectedLayerKey,
	);
	const selectLayer = useHyperframesStudioStore((state) => state.selectLayer);
	const previewIframe = useHyperframesStudioStore(
		(state) => state.previewIframe,
	);

	const handleSelect = (layer: StudioLayer) => {
		selectLayer({ key: layer.key, selector: layer.selector });
		postStudioPreviewAction({
			iframe: previewIframe,
			action: "select-element",
			payload: { selector: layer.selector, announce: true },
		});
	};

	const toggleHidden = async (layer: StudioLayer) => {
		const next = await applyStudioLayerPatches({
			html,
			layer,
			operations: [
				{
					type: "attribute",
					property: "hidden",
					value: layer.hidden ? null : "true",
				},
			],
		});
		if (next === html || !onCommit({ html: next })) return;
		postStudioPreviewAction({
			iframe: previewIframe,
			action: "patch-attribute",
			payload: {
				selector: layer.selector,
				property: "hidden",
				value: layer.hidden ? null : "true",
			},
		});
	};

	if (!document) {
		return (
			<div className="text-destructive p-3 text-xs">
				The composition could not be parsed. Open Source to repair it.
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="text-muted-foreground border-border/50 flex items-center justify-between border-b px-3 py-2 text-[10px]">
				<span>{document.layers.length} timed layers</span>
				<span>{document.duration.toFixed(2)}s</span>
			</div>
			<div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
				{document.layers.length === 0 ? (
					<div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-xs">
						<Layers3 className="size-6 opacity-50" />
						<p>No timed layers were found.</p>
					</div>
				) : (
					document.layers
						.slice()
						.sort((a, b) => b.track - a.track || a.start - b.start)
						.map((layer) => (
							<div
								key={layer.key}
								className={cn(
									"group mb-1 flex items-center rounded-md border transition-colors",
									selectedLayerKey === layer.key
										? "border-primary/50 bg-primary/10"
										: "border-transparent hover:bg-accent/70",
								)}
							>
								<button
									type="button"
									className="min-w-0 flex-1 px-2 py-1.5 text-left"
									onClick={() => handleSelect(layer)}
								>
									<div className="flex items-center gap-1.5">
										<CircleDot className="text-muted-foreground size-2.5 shrink-0" />
										<span className="truncate text-[11px] font-medium">
											{layer.label}
										</span>
									</div>
									<div className="text-muted-foreground mt-0.5 flex gap-2 pl-4 font-mono text-[9px]">
										<span>T{layer.track + 1}</span>
										<span>{layer.start.toFixed(2)}s</span>
										<span>{layer.duration.toFixed(2)}s</span>
									</div>
								</button>
								<button
									type="button"
									aria-label={layer.hidden ? "Show layer" : "Hide layer"}
									className="text-muted-foreground hover:text-foreground mr-1 flex size-7 items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10"
									onClick={() => void toggleHidden(layer)}
								>
									{layer.hidden ? (
										<EyeOff className="size-3.5" />
									) : (
										<Eye className="size-3.5" />
									)}
								</button>
							</div>
						))
				)}
			</div>
			<div className="text-muted-foreground border-border/50 flex items-center gap-1.5 border-t px-3 py-2 text-[10px]">
				<MousePointer2 className="size-3" />
				Select a layer here or directly in the preview.
			</div>
		</div>
	);
}

function SourceWorkspace({
	html,
	onCommit,
}: {
	html: string;
	onCommit: (html: string) => boolean;
}) {
	const [base, setBase] = useState(html);
	const [draft, setDraft] = useState(html);
	const [keepMine, setKeepMine] = useState(false);
	const externalConflict = html !== base && draft !== base && !keepMine;
	const sourceValue = html !== base && draft === base ? html : draft;
	const deferredSourceValue = useDeferredValue(sourceValue);
	const valid =
		deferredSourceValue === sourceValue &&
		quickValidate(deferredSourceValue) !== null;
	const dirty = sourceValue !== html;

	const apply = useCallback(() => {
		if (!valid || !dirty || externalConflict) return;
		if (onCommit(sourceValue)) {
			setBase(sourceValue);
			setDraft(sourceValue);
			setKeepMine(false);
			toast.success("Scene source updated");
		}
	}, [dirty, externalConflict, onCommit, sourceValue, valid]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-[#09090b]">
			{externalConflict && (
				<div className="border-caution/40 bg-caution/10 text-caution border-b px-3 py-2 text-[10px]">
					<p>The scene changed outside the source editor.</p>
					<div className="mt-1.5 flex gap-1.5">
						<Button
							variant="outline"
							size="sm"
							className="h-6 text-[10px]"
							onClick={() => {
								setBase(html);
								setDraft(html);
								setKeepMine(false);
							}}
						>
							Use latest
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-6 text-[10px]"
							onClick={() => {
								setBase(html);
								setKeepMine(true);
							}}
						>
							Keep mine
						</Button>
					</div>
				</div>
			)}
			<div className="min-h-0 flex-1">
				<HyperframesSourceEditor
					content={sourceValue}
					filePath="index.html"
					language="html"
					onChange={(value) => {
						if (html !== base && draft === base) setBase(html);
						setDraft(value);
					}}
				/>
			</div>
			<div className="border-border/60 bg-background border-t p-2">
				{!valid && (
					<p className="text-destructive mb-1.5 text-[10px]">
						A valid composition root with data-composition-id is required.
					</p>
				)}
				<div className="flex gap-1.5">
					<Button
						size="sm"
						className="h-7 flex-1 text-[11px]"
						disabled={!dirty || !valid || externalConflict}
						onClick={apply}
					>
						Apply source
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-[11px]"
						disabled={!dirty}
						onClick={() => {
							setBase(html);
							setDraft(html);
							setKeepMine(false);
						}}
					>
						<RefreshCw className="size-3" />
						Revert
					</Button>
				</div>
			</div>
		</div>
	);
}
