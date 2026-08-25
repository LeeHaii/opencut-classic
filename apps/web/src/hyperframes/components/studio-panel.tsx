"use client";

import { useCallback, useMemo, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Film, LogOut, RefreshCw } from "lucide-react";
import { useEditor } from "@/editor/use-editor";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { toast } from "sonner";
import type { FrameRate } from "opencut-wasm";
import { isNative, nativeInvoke } from "@opencut/hyperframes";
import {
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	roundFrameTime,
} from "@/wasm";
import type {
	HyperframesElement,
	SceneTracks,
	TimelineTrack,
} from "@/timeline";
import { useHyperframesStudioStore } from "../studio-store";

interface CompositionClip {
	id: string;
	tag: string;
	text: string;
	startSec: number;
	durationSec: number;
}

export function StudioPanelView() {
	const editor = useEditor();
	const activeElementId = useHyperframesStudioStore(
		(state) => state.activeElementId,
	);
	const exitStudio = useHyperframesStudioStore((state) => state.exit);
	const tracks = useEditor(
		(current) => current.scenes.getActiveSceneOrNull()?.tracks ?? null,
	);

	const located = useMemo(
		() => findStudioElement({ tracks, elementId: activeElementId }),
		[tracks, activeElementId],
	);

	if (!activeElementId || !located) {
		return (
			<PanelView title="Scene Studio" contentClassName="h-full">
				<div className="text-muted-foreground flex flex-col gap-2 px-1 py-6 text-xs">
					<p>
						Scene Studio edits a single AI motion scene with the live preview on
						the right.
					</p>
					<p>
						Open a scene from the{" "}
						<span className="text-foreground">AI Motion</span> panel or
						right-click an AI scene clip on the timeline.
					</p>
				</div>
			</PanelView>
		);
	}

	return (
		<StudioEditor
			key={`${located.element.id}:${located.element.html.length}`}
			element={located.element}
			trackId={located.trackId}
			fps={editor.project.getActiveOrNull()?.settings.fps}
			onExit={exitStudio}
		/>
	);
}

function StudioEditor({
	element,
	trackId,
	fps,
	onExit,
}: {
	element: HyperframesElement;
	trackId: string;
	fps?: FrameRate;
	onExit: () => void;
}) {
	const editor = useEditor();
	const setActiveTab = useAssetsPanelStore((state) => state.setActiveTab);
	const [name, setName] = useState(element.name);
	const [lengthLabel, setLengthLabel] = useState(() =>
		formatSecs(mediaTimeToSeconds({ time: element.duration })),
	);
	const [source, setSource] = useState(element.html);
	const isDirty = source !== element.html;
	const clips = useMemo(
		() => parseCompositionClips(element.html),
		[element.html],
	);

	const applySource = useCallback(() => {
		const next = source.trim();
		if (!next || next === element.html) return;
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: {
						html: next,
						renderedMediaId: undefined,
						renderHash: undefined,
					},
				},
			],
		});
		toast.success("Scene source updated");
	}, [editor, element.html, element.id, source, trackId]);

	const commitName = useCallback(() => {
		const trimmed = name.trim();
		if (!trimmed || trimmed === element.name) return;
		editor.timeline.updateElements({
			updates: [{ trackId, elementId: element.id, patch: { name: trimmed } }],
		});
	}, [editor, element.id, element.name, name, trackId]);

	const commitLength = useCallback(() => {
		const parsed = Number.parseFloat(lengthLabel.replace(",", "."));
		if (!Number.isFinite(parsed) || parsed <= 0) {
			setLengthLabel(
				formatSecs(mediaTimeToSeconds({ time: element.duration })),
			);
			return;
		}
		const time = fps
			? roundFrameTime({
					time: mediaTimeFromSeconds({ seconds: parsed }),
					fps,
				})
			: mediaTimeFromSeconds({ seconds: parsed });
		if (time === element.duration) return;
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: { duration: time, sourceDuration: time },
				},
			],
		});
	}, [editor, element.duration, element.id, fps, lengthLabel, trackId]);

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
			toast.info("Render started — progress shows in the AI Motion panel");
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
			contentClassName="h-full"
		>
			<div className="flex h-full flex-col gap-3 pb-4">
				<p className="text-muted-foreground px-1 text-[10px] leading-relaxed">
					The preview shows this scene live and follows the timeline playhead.
					Edits here update the timeline element in place.
				</p>

				<div className="grid grid-cols-2 gap-1.5">
					<div className="space-y-1">
						<SectionLabel>Name</SectionLabel>
						<Input
							size="xs"
							value={name}
							maxLength={80}
							spellCheck={false}
							onChange={(event) => setName(event.target.value)}
							onBlur={commitName}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									event.currentTarget.blur();
								}
							}}
						/>
					</div>
					<div className="space-y-1">
						<SectionLabel>Length · seconds</SectionLabel>
						<Input
							size="xs"
							type="number"
							inputMode="decimal"
							min={0.5}
							step={0.5}
							value={lengthLabel}
							onChange={(event) => setLengthLabel(event.target.value)}
							onBlur={commitLength}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									event.currentTarget.blur();
								}
							}}
						/>
					</div>
				</div>

				<div className="space-y-1">
					<div className="flex items-center justify-between px-0.5">
						<SectionLabel>Clips ({clips.length})</SectionLabel>
						<span className="text-muted-foreground text-[9px]">
							read-only · edit via source or AI
						</span>
					</div>
					<div className="border-border/60 bg-muted/15 max-h-32 overflow-y-auto rounded-md border">
						{clips.length === 0 ? (
							<p className="text-muted-foreground px-2 py-2 text-[10px]">
								No timed clips found in this composition.
							</p>
						) : (
							clips.map((clip) => (
								<div
									key={clip.id}
									className="border-border/40 flex items-center gap-2 border-b px-2 py-1 text-[10px] last:border-b-0"
								>
									<Film className="text-muted-foreground size-3 shrink-0" />
									<span className="w-16 shrink-0 truncate font-mono">
										{formatSecs(clip.startSec)}s
									</span>
									<span className="w-12 shrink-0 font-mono">
										{formatSecs(clip.durationSec)}s
									</span>
									<span className="text-muted-foreground truncate">
										{clip.text || clip.tag}
									</span>
								</div>
							))
						)}
					</div>
				</div>

				<div className="flex min-h-0 flex-1 flex-col gap-1">
					<div className="flex items-center justify-between px-0.5">
						<SectionLabel>HTML source</SectionLabel>
						{isDirty && (
							<span className="text-amber-600 text-[9px] font-medium">
								unsaved
							</span>
						)}
					</div>
					<Textarea
						value={source}
						onChange={(event) => setSource(event.target.value)}
						spellCheck={false}
						className="border-border/60 min-h-40 flex-1 resize-none font-mono text-[10px] leading-relaxed"
					/>
					<div className="flex gap-1.5">
						<Button
							size="sm"
							className="h-7 flex-1 text-[11px]"
							disabled={!isDirty}
							onClick={applySource}
						>
							Apply changes
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-[11px]"
							disabled={!isDirty}
							onClick={() => setSource(element.html)}
						>
							<RefreshCw className="size-3" />
							Revert
						</Button>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-1.5 border-t pt-2">
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
						Render MP4
					</Button>
				</div>
			</div>
		</PanelView>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="text-muted-foreground px-0.5 text-[9px] font-medium tracking-[0.08em] uppercase">
			{children}
		</p>
	);
}

function formatSecs(value: number): string {
	return String(Number.parseFloat(value.toFixed(2)));
}

function findStudioElement({
	tracks,
	elementId,
}: {
	tracks: SceneTracks | null;
	elementId: string | null;
}): { trackId: string; element: HyperframesElement } | null {
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

function parseCompositionClips(html: string): CompositionClip[] {
	if (typeof DOMParser === "undefined") return [];
	const doc = new DOMParser().parseFromString(html, "text/html");
	const root = doc.querySelector("[data-composition-id]");
	if (!root) return [];
	return Array.from(root.querySelectorAll("[data-start]")).map(
		(node, index) => ({
			id: node.id || `clip-${index}`,
			tag: node.tagName.toLowerCase(),
			text: (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48),
			startSec: Number.parseFloat(node.getAttribute("data-start") ?? "0") || 0,
			durationSec:
				Number.parseFloat(node.getAttribute("data-duration") ?? "0") || 0,
		}),
	);
}
