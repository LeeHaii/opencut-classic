"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	ExternalLink,
	Film,
	ImagePlus,
	Layers,
	SendHorizontal,
	Sparkles,
	UserRound,
	X,
} from "lucide-react";
import { toast } from "sonner";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useEditor } from "@/editor/use-editor";
import type { EditorCore } from "@/core";
import {
	auditCompositionAnimation,
	buildAgentPrompt,
	buildSeedComposition,
	extractHtml,
	quickValidate,
	isNative,
	nativeInvoke,
	onAntigravityChunk,
	onAntigravityDone,
	onAntigravityError,
	onStudioHtmlChanged,
	DEFAULT_ANTIGRAVITY_MODELS,
	type AgentChatMessage,
	type AgentDonePayload,
	type AntigravityStatus,
} from "@opencut/hyperframes";
import { buildHyperframesElement } from "@/timeline/element-utils";
import {
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	roundFrameTime,
} from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import { renderHyperframesElement } from "../render-element";
import { runBrowserHyperframesAgent } from "../browser-agent";
import { useHyperframesPanelStore } from "../store";
import { useHyperframesStudioStore } from "../studio-store";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { loadApiKeys } from "@/plugins/rhymx/settings";
import type {
	HyperframesElement,
	SceneTracks,
	TimelineTrack,
} from "@/timeline";
import { cn } from "@/utils/ui";

function newId(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);
}

interface NativeRenderStatus {
	node: { found: boolean; version?: string };
	hyperframes_cli: { found: boolean; version?: string };
}

export function AiMotionPanelView() {
	const editor = useEditor();
	const [project, tracks] = useEditor(
		(current) =>
			[
				current.project.getActiveOrNull(),
				current.scenes.getActiveSceneOrNull()?.tracks ?? null,
			] as const,
	);
	const store = useHyperframesPanelStore();
	const [activeElementId, setActiveElementId] = useState<string | null>(null);
	const [renderBusy, setRenderBusy] = useState<string | null>(null);
	const [renderNote, setRenderNote] = useState<string | null>(null);
	const [nativeActionError, setNativeActionError] = useState<string | null>(
		null,
	);
	const [nativeRenderStatus, setNativeRenderStatus] =
		useState<NativeRenderStatus | null>(null);
	const browserRuns = useRef(new Map<string, AbortController>());

	const native = isNative();
	const hyperframesElements = collectHyperframesElements({ tracks });
	const resolvedActiveElementId = hyperframesElements.some(
		(entry) => entry.element.id === activeElementId,
	)
		? activeElementId
		: (hyperframesElements[0]?.element.id ?? null);

	const activeEntry = hyperframesElements.find(
		(entry) => entry.element.id === resolvedActiveElementId,
	);

	// --- Native status + event subscriptions ---------------------------------
	useEffect(() => {
		if (!native) return;
		let cancelled = false;
		void (async () => {
			try {
				const [status, renderStatus] = await Promise.all([
					nativeInvoke<AntigravityStatus>("antigravity_status"),
					nativeInvoke<NativeRenderStatus>("hf_doctor"),
				]);
				if (!cancelled) {
					useHyperframesPanelStore.getState().setStatus(status);
					setNativeRenderStatus(renderStatus);
				}
			} catch {
				/* ignore */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [native]);

	// --- Actions --------------------------------------------------------------
	const insertScene = useCallback(() => {
		const settings = editor.project.getActiveOrNull()?.settings;
		const width = settings?.canvasSize.width ?? 1920;
		const height = settings?.canvasSize.height ?? 1080;
		const compositionId = `hf-${newId().replace(/-/g, "").slice(0, 12)}`;
		const existingNames = collectHyperframesElements({
			tracks: editor.scenes.getActiveSceneOrNull()?.tracks ?? null,
		}).map(({ element }) => element.name);
		const element = buildHyperframesElement({
			compositionId,
			name: nextUniqueSceneName(existingNames),
			startTime: editor.playback.getCurrentTime(),
			duration: mediaTimeFromSeconds({ seconds: DEFAULT_SCENE_DURATION_SECS }),
			width,
			height,
		});
		editor.timeline.insertElement({ element, placement: { mode: "auto" } });
	}, [editor]);

	const renameActiveScene = (name: string) => {
		const entry = activeEntry;
		if (!entry) return;
		const trimmed = name.trim();
		if (!trimmed || trimmed === entry.element.name) return;
		editor.timeline.updateElements({
			updates: [
				{
					trackId: entry.trackId,
					elementId: entry.element.id,
					patch: { name: trimmed },
				},
			],
		});
	};

	const handleSend = async ({
		request,
		images = [],
	}: {
		request: string;
		images?: string[];
	}) => {
		const entry = resolvedActiveElementId
			? findEntry({ editor, elementId: resolvedActiveElementId })
			: null;
		if (!entry || !project) return;
		const element = entry.element;
		const settings = project.settings;
		const fps = Math.round(frameRateToFloat(settings.fps));
		const durationSecs = mediaTimeToSeconds({ time: element.duration });

		const chats = store.chats[element.id] ?? [];
		const userMessage: AgentChatMessage = {
			id: newId(),
			role: "user",
			text: request,
			createdAt: new Date().toISOString(),
			...(images.length > 0 ? { images } : {}),
		};
		store.appendChat({ elementId: element.id, message: userMessage });

		const seed =
			element.html.trim().length > 0
				? ""
				: `\nFresh child-composition starting point:\n\`\`\`html\n${buildSeedComposition(
						{
							compositionId: element.compositionId,
							width: element.width,
							height: element.height,
							durationSecs: durationSecs,
							fps,
						},
					)}\n\`\`\`\n`;
		const current =
			element.html.trim().length > 0
				? `\nCurrent composition source:\n\`\`\`html\n${element.html}\n\`\`\`\n`
				: "";

		const prompt = `${buildAgentPrompt({
			request,
			compositionId: element.compositionId,
			durationSecs,
			width: element.width,
			height: element.height,
			fps,
			recentTurns: chats.slice(-6),
		})}${seed}${current}`;

		const requestId = newId();
		store.setRun({
			elementId: element.id,
			run: { running: true, requestId },
		});
		try {
			if (native) {
				await nativeInvoke("antigravity_run", {
					request: {
						requestId,
						projectId: project.metadata.id,
						prompt,
						conversationId: element.agent?.conversationId ?? undefined,
						model: store.model || undefined,
						...(images.length > 0 ? { images } : {}),
					},
				});
				return;
			}

			const controller = new AbortController();
			browserRuns.current.set(element.id, controller);
			const text = await runBrowserHyperframesAgent({
				prompt,
				apiKey: loadApiKeys().groq || undefined,
				images,
				signal: controller.signal,
			});
			const html = extractHtml(text);
			const info = html ? quickValidate(html) : null;
			store.appendChat({
				elementId: element.id,
				message: {
					id: newId(),
					role: "assistant",
					text: summaryFromReply(text),
					createdAt: new Date().toISOString(),
				},
			});
			if (!html || !info) {
				throw new Error(
					"The browser agent did not return a valid HyperFrames composition. Try rephrasing.",
				);
			}
			const currentEntry = findEntry({ editor, elementId: element.id });
			if (!currentEntry) return;
			editor.timeline.updateElements({
				updates: [
					{
						trackId: currentEntry.trackId,
						elementId: element.id,
						patch: {
							html,
							duration: mediaTimeFromSeconds({ seconds: info.durationSecs }),
							sourceDuration: mediaTimeFromSeconds({
								seconds: info.durationSecs,
							}),
							renderedMediaId: undefined,
							renderHash: undefined,
							agent: {
								model: "groq-browser",
								updatedAt: new Date().toISOString(),
							},
						},
					},
				],
			});
			warnIfStatic({ elementId: element.id, html, state: store });
		} catch (error) {
			const cancelled =
				error instanceof DOMException && error.name === "AbortError";
			store.appendChat({
				elementId: element.id,
				message: {
					id: newId(),
					role: "system",
					text: cancelled
						? "Generation cancelled."
						: error instanceof Error
							? error.message
							: String(error),
					createdAt: new Date().toISOString(),
				},
			});
		} finally {
			if (!native) {
				browserRuns.current.delete(element.id);
				store.setRun({ elementId: element.id, run: { running: false } });
			}
		}
	};

	const changeSceneLength = (seconds: number) => {
		const entry = activeEntry;
		if (!entry || !Number.isFinite(seconds)) return;
		const requested = Math.min(
			MAX_SCENE_LENGTH_SECS,
			Math.max(MIN_SCENE_LENGTH_SECS, seconds),
		);
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		const rawTime = mediaTimeFromSeconds({ seconds: requested });
		const time = fps ? roundFrameTime({ time: rawTime, fps }) : rawTime;
		const nextSecs = mediaTimeToSeconds({ time });
		const currentSecs = mediaTimeToSeconds({ time: entry.element.duration });
		if (
			nextSecs <= 0 ||
			Math.abs(nextSecs - currentSecs) < LENGTH_EPSILON_SECS
		) {
			return;
		}

		editor.timeline.updateElements({
			updates: [
				{
					trackId: entry.trackId,
					elementId: entry.element.id,
					patch: { duration: time, sourceDuration: time },
				},
			],
		});

		const hasHtml = entry.element.html.trim().length > 0;
		const isRunning =
			useHyperframesPanelStore.getState().runs[entry.element.id]?.running ??
			false;
		if (hasHtml && !isRunning) {
			void handleSend({
				request: `Change the total composition duration to exactly ${formatLengthLabel(nextSecs)} seconds. Keep the existing visual style and content, and retime or extend every clip so the animation fills the full duration.`,
			});
		}
	};

	const applyGeneratedHtml = useCallback(
		({
			elementId,
			html,
			durationSecs,
			conversationId,
		}: {
			elementId: string;
			html: string;
			durationSecs: number;
			conversationId?: string;
		}) => {
			const located = findEntry({ editor, elementId });
			if (!located) return;
			useHyperframesPanelStore.getState().setRun({
				elementId,
				run: { running: false },
			});
			editor.timeline.updateElements({
				updates: [
					{
						trackId: located.trackId,
						elementId,
						patch: {
							html,
							duration: mediaTimeFromSeconds({ seconds: durationSecs }),
							sourceDuration: mediaTimeFromSeconds({ seconds: durationSecs }),
							renderedMediaId: undefined,
							renderHash: undefined,
							agent: {
								conversationId,
								model: useHyperframesPanelStore.getState().model || undefined,
								updatedAt: new Date().toISOString(),
							},
						},
					},
				],
			});
		},
		[editor],
	);

	const handleAgentDone = useCallback(
		async (payload: AgentDonePayload) => {
			const state = useHyperframesPanelStore.getState();
			const entry = Object.entries(state.runs).find(
				([, run]) => run.requestId === payload.requestId,
			);
			if (!entry) return;
			const [elementId] = entry;
			state.setRun({ elementId, run: { running: false } });

			const html = extractHtml(payload.text);
			const info = html ? quickValidate(html) : null;

			state.appendChat({
				elementId,
				message: {
					id: newId(),
					role: "assistant",
					text: summaryFromReply(payload.text),
					createdAt: new Date().toISOString(),
				},
			});

			if (!html || !info) {
				state.appendChat({
					elementId,
					message: {
						id: newId(),
						role: "system",
						text: "The reply did not contain a valid HyperFrames composition. Try rephrasing.",
						createdAt: new Date().toISOString(),
					},
				});
				return;
			}

			applyGeneratedHtml({
				elementId,
				html,
				durationSecs: info.durationSecs,
				conversationId: payload.conversationId,
			});
			warnIfStatic({ elementId, html, state });
		},
		[applyGeneratedHtml],
	);

	const handleAgentError = useCallback(
		(payload: { requestId: string; message: string }) => {
			const state = useHyperframesPanelStore.getState();
			const entry = Object.entries(state.runs).find(
				([, run]) => run.requestId === payload.requestId,
			);
			if (!entry) return;
			const [elementId] = entry;
			state.setRun({ elementId, run: { running: false } });
			state.appendChat({
				elementId,
				message: {
					id: newId(),
					role: "system",
					text: payload.message,
					createdAt: new Date().toISOString(),
				},
			});
		},
		[],
	);

	const handleStudioChange = useCallback(
		(payload: { projectId: string; elementId: string; html: string }) => {
			const located = findEntry({ editor, elementId: payload.elementId });
			if (!located) return;
			editor.timeline.updateElements({
				updates: [
					{
						trackId: located.trackId,
						elementId: payload.elementId,
						patch: {
							html: payload.html,
							renderedMediaId: undefined,
							renderHash: undefined,
						},
					},
				],
			});
		},
		[editor],
	);

	const handleRender = async () => {
		const entry = activeEntry;
		if (!entry || !native || !project) return;
		setNativeActionError(null);
		setRenderBusy(entry.element.id);
		try {
			await renderHyperframesElement({
				editor,
				elementId: entry.element.id,
				onProgress: ({ message }) => setRenderNote(message),
			});
			toast.success("HyperFrames MP4 rendered and added to the scene.");
		} catch (error) {
			const message = errorMessage(error);
			setNativeActionError(message);
			toast.error("MP4 render failed", { description: message });
		} finally {
			setRenderBusy(null);
			setRenderNote(null);
		}
	};

	const handleOpenStudio = async () => {
		const entry = activeEntry;
		if (!entry || !native || !project) return;
		setNativeActionError(null);
		try {
			const result = await nativeInvoke<{ url: string }>("studio_open", {
				request: {
					projectId: project.metadata.id,
					elementId: entry.element.id,
					html: entry.element.html,
					compositionId: entry.element.compositionId,
					width: entry.element.width,
					height: entry.element.height,
					durationSecs: mediaTimeToSeconds({ time: entry.element.duration }),
				},
			});
			const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
			const existing = await WebviewWindow.getByLabel("hyperframes-studio");
			if (existing) {
				void existing.setFocus();
				return;
			}
			void new WebviewWindow("hyperframes-studio", {
				url: result.url,
				title: "HyperFrames Studio",
				width: 1280,
				height: 800,
			});
		} catch (error) {
			const message = errorMessage(error);
			setNativeActionError(message);
			toast.error("Could not open HyperFrames Studio", {
				description: message,
			});
		}
	};

	/** Opens the in-app Scene Studio focused on the active scene. */
	const openInStudio = () => {
		const entry = activeEntry;
		if (!entry) return;
		useHyperframesStudioStore.getState().enter({ elementId: entry.element.id });
		editor.playback.seek({ time: entry.element.startTime });
		useAssetsPanelStore.getState().setActiveTab("studio");
	};

	useEffect(() => {
		if (!native) return;
		let disposed = false;
		const unlisteners: Array<() => void> = [];
		const addUnlistener = async (subscription: Promise<() => void>) => {
			const unlisten = await subscription;
			if (disposed) {
				unlisten();
				return;
			}
			unlisteners.push(unlisten);
		};

		void Promise.all([
			addUnlistener(
				onAntigravityChunk(({ requestId, chunk }) => {
					const state = useHyperframesPanelStore.getState();
					for (const [elementId, runState] of Object.entries(state.runs)) {
						if (runState.requestId === requestId) {
							state.setRun({
								elementId,
								run: { ...runState, streamLine: chunk.slice(0, 160) },
							});
						}
					}
				}),
			),
			addUnlistener(onAntigravityDone(handleAgentDone)),
			addUnlistener(onAntigravityError(handleAgentError)),
			addUnlistener(onStudioHtmlChanged(handleStudioChange)),
		]).catch((error: unknown) => {
			console.warn("[hyperframes] native event subscription failed:", error);
		});

		return () => {
			disposed = true;
			for (const unlisten of unlisteners) unlisten();
		};
	}, [handleAgentDone, handleAgentError, handleStudioChange, native]);

	// --- Render ----------------------------------------------------------------
	const chat = resolvedActiveElementId
		? (store.chats[resolvedActiveElementId] ?? [])
		: [];
	const run = resolvedActiveElementId
		? store.runs[resolvedActiveElementId]
		: undefined;
	const status = store.status;
	const models =
		store.models.length > 0 ? store.models : DEFAULT_ANTIGRAVITY_MODELS;
	const activeLengthSecs = activeEntry
		? mediaTimeToSeconds({ time: activeEntry.element.duration })
		: 0;

	return (
		<PanelView title="AI Motion" contentClassName="h-full">
			<div className="flex min-h-full flex-col gap-2 pb-4">
				{!native && (
					<div className="border-border/60 bg-muted/30 text-muted-foreground flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-relaxed">
						<Sparkles className="text-primary mt-px size-3 shrink-0" />
						<p>
							<span className="text-foreground font-medium">Browser AI</span> —
							Groq generates the scene; OpenCut renders HTML/CSS/GSAP locally
							with WebCodecs.
						</p>
					</div>
				)}

				{native && status && (
					<div className="border-border/60 bg-muted/25 flex items-center gap-2 rounded-md border px-2 py-1.5 text-[10px]">
						{status.installed ? (
							<CheckCircle2 className="size-3 shrink-0 text-emerald-600" />
						) : (
							<AlertTriangle className="size-3 shrink-0 text-destructive" />
						)}
						<div className="min-w-0 flex-1 leading-tight">
							<p className="text-foreground truncate font-medium">
								{status.installed
									? (status.accountEmail ?? "Antigravity CLI detected")
									: "Antigravity CLI not found"}
							</p>
							<p className="text-muted-foreground truncate text-[9px]">
								{status.installed
									? "Desktop agent ready"
									: "Install the CLI to generate scenes"}
							</p>
						</div>
						{status.installed && !status.minimumVersionMet && (
							<span className="text-destructive shrink-0 text-[9px]">
								Update CLI
							</span>
						)}
						{status.installed && !status.accountEmail && (
							<Button
								size="sm"
								variant="secondary"
								className="h-5 rounded px-1.5 text-[9px]"
								onClick={() => void nativeInvoke("antigravity_login")}
							>
								Sign in
							</Button>
						)}
					</div>
				)}

				{native && nativeRenderStatus && (
					<div
						className={cn(
							"flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px]",
							nativeRenderStatus.node.found &&
								nativeRenderStatus.hyperframes_cli.found
								? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
								: "border-destructive/20 bg-destructive/5 text-destructive",
						)}
					>
						<Film className="size-3 shrink-0" />
						<span className="truncate">
							{nativeRenderStatus.node.found &&
							nativeRenderStatus.hyperframes_cli.found
								? `Renderer ready${nativeRenderStatus.hyperframes_cli.version ? ` · ${nativeRenderStatus.hyperframes_cli.version}` : ""}`
								: "Renderer setup is incomplete"}
						</span>
					</div>
				)}

				<Button size="sm" className="h-8 w-full" onClick={insertScene}>
					<Sparkles className="size-3.5" />
					Add AI scene at playhead
				</Button>

				{hyperframesElements.length > 0 && (
					<div className="space-y-1.5">
						<SectionLabel>Scene</SectionLabel>
						<Select
							value={resolvedActiveElementId ?? ""}
							onValueChange={(value) => {
								setActiveElementId(value);
								setNativeActionError(null);
							}}
						>
							<SelectTrigger className="h-8 text-xs">
								<SelectValue placeholder="Select scene" />
							</SelectTrigger>
							<SelectContent>
								{hyperframesElements.map(({ element }) => (
									<SelectItem key={element.id} value={element.id}>
										{element.name}
										{element.renderedMediaId ? " · rendered" : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{activeEntry && (
							<div className="grid grid-cols-2 gap-1.5">
								<SceneNameField
									key={`name-${activeEntry.element.id}:${activeEntry.element.name}`}
									initialName={activeEntry.element.name}
									onCommit={renameActiveScene}
								/>
								<SceneLengthField
									key={`length-${activeEntry.element.id}:${formatLengthLabel(activeLengthSecs)}`}
									seconds={activeLengthSecs}
									disabled={run?.running === true}
									onCommit={changeSceneLength}
								/>
							</div>
						)}
					</div>
				)}

				{activeEntry && (
					<>
						{native && status?.installed && (
							<div className="space-y-1.5">
								<SectionLabel>Model</SectionLabel>
								<Select
									value={store.model}
									onValueChange={(value) => store.setModel(value)}
								>
									<SelectTrigger className="h-8 text-xs">
										<SelectValue placeholder="Choose a model" />
									</SelectTrigger>
									<SelectContent>
										{models.map((model) => (
											<SelectItem key={model} value={model}>
												{model}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						<div className="space-y-1.5">
							<div className="flex items-center justify-between px-0.5">
								<SectionLabel>Conversation</SectionLabel>
								<span className="text-muted-foreground text-[9px]">
									{chat.length} {chat.length === 1 ? "message" : "messages"}
								</span>
							</div>
							<ChatHistory messages={chat} />
						</div>

						{run?.running && (
							<div className="border-primary/20 bg-primary/5 text-muted-foreground flex items-center gap-2 rounded-md border px-2 py-1.5 text-[10px]">
								<Spinner className="size-3" />
								<span className="truncate font-mono">
									{run.streamLine ?? "Working…"}
								</span>
								<Button
									variant="ghost"
									size="sm"
									className="ml-auto h-5 rounded px-1.5 text-[9px]"
									onClick={() => {
										if (native && run.requestId) {
											void nativeInvoke("antigravity_cancel", {
												requestId: run.requestId,
											});
										} else {
											browserRuns.current.get(activeEntry.element.id)?.abort();
										}
									}}
								>
									Cancel
								</Button>
							</div>
						)}

						<PromptInput
							disabled={run?.running || (native && !status?.installed)}
							onSubmit={({ value, images }) =>
								void handleSend({ request: value, images })
							}
						/>

						{nativeActionError && (
							<div className="border-destructive/25 bg-destructive/8 text-destructive flex gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-relaxed">
								<AlertTriangle className="mt-px size-3 shrink-0" />
								<span>{nativeActionError}</span>
							</div>
						)}

						<Button
							variant="secondary"
							size="sm"
							className="h-8 w-full text-[11px]"
							onClick={openInStudio}
							disabled={!activeEntry.element.html}
						>
							<Layers className="size-3.5" />
							Edit in Studio
						</Button>

						<div className="grid grid-cols-2 gap-1.5 border-t pt-2">
							{native ? (
								<Button
									variant="default"
									size="sm"
									className="h-8 min-w-0 px-2 text-[11px]"
									onClick={() => void handleRender()}
									disabled={
										!activeEntry.element.html ||
										renderBusy === activeEntry.element.id ||
										nativeRenderStatus?.node.found === false ||
										nativeRenderStatus?.hyperframes_cli.found === false
									}
								>
									<Film className="size-3.5" />
									{renderBusy === activeEntry.element.id
										? (renderNote ?? "Rendering…")
										: activeEntry.element.renderedMediaId
											? "Re-render MP4"
											: "Render MP4"}
								</Button>
							) : (
								<p className="text-muted-foreground col-span-2 px-0.5 text-[10px] leading-relaxed">
									No pre-render needed: Export renders this scene locally in the
									browser.
								</p>
							)}
							<Button
								variant="outline"
								size="sm"
								className="h-8 min-w-0 px-2 text-[11px]"
								onClick={() => void handleOpenStudio()}
								disabled={!native || !activeEntry.element.html}
							>
								<ExternalLink className="size-3.5" />
								Open Studio
							</Button>
						</div>
					</>
				)}
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

function SceneNameField({
	initialName,
	onCommit,
}: {
	initialName: string;
	onCommit: (name: string) => void;
}) {
	const [value, setValue] = useState(initialName);
	const commit = () => {
		const trimmed = value.trim();
		if (!trimmed) {
			setValue(initialName);
			return;
		}
		if (trimmed !== initialName) {
			onCommit(trimmed);
		}
	};
	return (
		<div className="space-y-1">
			<SectionLabel>Name</SectionLabel>
			<Input
				size="xs"
				aria-label="Scene name"
				value={value}
				spellCheck={false}
				maxLength={80}
				onChange={(event) => setValue(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
			/>
		</div>
	);
}

function SceneLengthField({
	seconds,
	disabled,
	onCommit,
}: {
	seconds: number;
	disabled: boolean;
	onCommit: (seconds: number) => void;
}) {
	const [value, setValue] = useState(() => formatLengthLabel(seconds));
	const commit = () => {
		const parsed = Number.parseFloat(value.replace(",", "."));
		if (!Number.isFinite(parsed)) {
			setValue(formatLengthLabel(seconds));
			return;
		}
		setValue(formatLengthLabel(parsed));
		onCommit(parsed);
	};
	return (
		<div className="space-y-1">
			<SectionLabel>Length · seconds</SectionLabel>
			<Input
				size="xs"
				type="number"
				aria-label="Scene length in seconds"
				inputMode="decimal"
				min={MIN_SCENE_LENGTH_SECS}
				max={MAX_SCENE_LENGTH_SECS}
				step={0.5}
				value={value}
				disabled={disabled}
				onChange={(event) => setValue(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
			/>
		</div>
	);
}

function ChatHistory({ messages }: { messages: AgentChatMessage[] }) {
	if (messages.length === 0) {
		return (
			<div className="border-border/60 bg-muted/20 flex min-h-20 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-4 text-center">
				<div className="bg-primary/10 text-primary mb-1.5 flex size-6 items-center justify-center rounded-full">
					<Bot className="size-3" />
				</div>
				<p className="text-foreground text-[11px] font-medium">Build with AI</p>
				<p className="text-muted-foreground mt-0.5 text-[10px] leading-relaxed">
					Describe a title, data card, transition, or complete motion scene.
				</p>
			</div>
		);
	}
	return (
		<div className="border-border/60 bg-muted/15 flex max-h-[32vh] min-h-24 flex-col gap-2 overflow-y-auto rounded-lg border p-1.5">
			{messages.map((message) => {
				if (message.role === "system") {
					return (
						<div
							key={message.id}
							className="border-destructive/20 bg-destructive/8 text-destructive flex gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-relaxed"
						>
							<AlertTriangle className="mt-px size-3 shrink-0" />
							<span className="whitespace-pre-wrap">{message.text}</span>
						</div>
					);
				}
				const user = message.role === "user";
				return (
					<div
						key={message.id}
						className={cn("flex gap-1.5", user && "flex-row-reverse")}
					>
						<div
							className={cn(
								"mt-3.5 flex size-5 shrink-0 items-center justify-center rounded-full",
								user
									? "bg-primary text-primary-foreground"
									: "bg-foreground text-background",
							)}
						>
							{user ? (
								<UserRound className="size-2.5" />
							) : (
								<Bot className="size-2.5" />
							)}
						</div>
						<div className={cn("max-w-[85%]", user && "text-right")}>
							<p className="text-muted-foreground mb-0.5 px-0.5 text-[8px] font-medium tracking-wide uppercase">
								{user ? "You" : "Antigravity"}
							</p>
							<div
								className={cn(
									"whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-left text-[11px] leading-relaxed",
									user
										? "bg-primary text-primary-foreground rounded-tr-sm"
										: "bg-background border-border/60 rounded-tl-sm border",
								)}
							>
								{message.text}
								{message.images && message.images.length > 0 && (
									<div className="mt-1 flex flex-wrap gap-1">
										{message.images.map((src, index) => (
											<img
												key={`${message.id}-image-${index}`}
												src={src}
												alt={`Reference ${index + 1}`}
												className="size-12 rounded border border-current/20 object-cover"
											/>
										))}
									</div>
								)}
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}

interface AttachmentImage {
	id: string;
	dataUrl: string;
}

function PromptInput({
	disabled,
	onSubmit,
}: {
	disabled: boolean;
	onSubmit: (args: { value: string; images: string[] }) => void;
}) {
	const [value, setValue] = useState("");
	const [images, setImages] = useState<AttachmentImage[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const addFiles = useCallback(async (files: FileList | File[] | null) => {
		if (!files) return;
		const accepted: AttachmentImage[] = [];
		for (const file of Array.from(files)) {
			if (!file.type.startsWith("image/")) continue;
			if (file.size > MAX_ATTACHMENT_BYTES) {
				toast.error(
					`"${file.name}" exceeds the ${MAX_ATTACHMENT_MB} MB image limit`,
				);
				continue;
			}
			try {
				accepted.push({
					id: newId(),
					dataUrl: await readFileAsDataUrl(file),
				});
			} catch {
				toast.error(`Could not read "${file.name}"`);
			}
		}
		if (accepted.length > 0) {
			setImages((current) =>
				[...current, ...accepted].slice(0, MAX_ATTACHMENTS),
			);
		}
	}, []);

	const removeImage = (id: string) => {
		setImages((current) => current.filter((image) => image.id !== id));
	};

	const submit = () => {
		const trimmed = value.trim();
		if (!trimmed && images.length === 0) return;
		onSubmit({
			value: trimmed || defaultRequestForImages(images.length),
			images: images.map((image) => image.dataUrl),
		});
		setValue("");
		setImages([]);
	};
	return (
		<form
			className="border-border/60 bg-background focus-within:border-primary/40 rounded-lg border p-1.5 shadow-xs transition-colors"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			{images.length > 0 && (
				<div className="mb-1 flex flex-wrap gap-1">
					{images.map((image) => (
						<div key={image.id} className="group relative">
							<img
								src={image.dataUrl}
								alt="Reference attachment"
								className="border-border/60 size-11 rounded border object-cover"
							/>
							<button
								type="button"
								aria-label="Remove attachment"
								className="bg-foreground text-background absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
								onClick={() => removeImage(image.id)}
							>
								<X className="size-2" />
							</button>
						</div>
					))}
				</div>
			)}
			<Textarea
				value={value}
				placeholder="Describe what to create or change…"
				onChange={(event) => setValue(event.target.value)}
				onPaste={(event) => {
					const files = Array.from(event.clipboardData.files).filter((file) =>
						file.type.startsWith("image/"),
					);
					if (files.length > 0) {
						event.preventDefault();
						void addFiles(files);
					}
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						submit();
					}
				}}
				className="bg-transparent min-h-11 resize-none border-0 p-1 text-[11px] shadow-none focus-visible:border-0"
				disabled={disabled}
			/>
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				multiple
				className="hidden"
				onChange={(event) => {
					void addFiles(event.target.files);
					event.target.value = "";
				}}
			/>
			<div className="mt-0.5 flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="text-muted-foreground h-6.5 w-6.5 shrink-0 rounded px-0"
						aria-label="Attach reference image"
						disabled={disabled || images.length >= MAX_ATTACHMENTS}
						onClick={() => fileInputRef.current?.click()}
					>
						<ImagePlus className="size-3.5" />
					</Button>
					<span className="text-muted-foreground truncate pl-0.5 text-[9px]">
						Shift + Enter for a new line · paste or attach images
					</span>
				</div>
				<Button
					type="submit"
					size="sm"
					className="h-6.5 px-2 text-[10px]"
					disabled={disabled || (!value.trim() && images.length === 0)}
				>
					<SendHorizontal className="size-3" />
					Send
				</Button>
			</div>
		</form>
	);
}

// --- Helpers -----------------------------------------------------------------

function findEntry({
	editor,
	elementId,
}: {
	editor: EditorCore;
	elementId: string;
}): { trackId: string; element: HyperframesElement } | null {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
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

function collectHyperframesElements({
	tracks,
}: {
	tracks: SceneTracks | null;
}): Array<{ trackId: string; element: HyperframesElement }> {
	if (!tracks) return [];
	const allTracks: TimelineTrack[] = [...tracks.overlay, tracks.main];
	const found: Array<{ trackId: string; element: HyperframesElement }> = [];
	for (const track of allTracks) {
		for (const element of track.elements) {
			if (element.type === "hyperframes") {
				found.push({ trackId: track.id, element });
			}
		}
	}
	return found;
}

function summaryFromReply(text: string): string {
	const withoutFence = text.replace(/```[\s\S]*?```/g, "").trim();
	return withoutFence.length > 0
		? withoutFence.slice(0, 2000)
		: "Scene updated.";
}

function warnIfStatic({
	elementId,
	html,
	state,
}: {
	elementId: string;
	html: string;
	state: ReturnType<typeof useHyperframesPanelStore.getState>;
}) {
	const animation = auditCompositionAnimation(html);
	if (animation.hasTweens) return;
	state.appendChat({
		elementId,
		message: {
			id: newId(),
			role: "system",
			text: "This scene looks static — no seekable GSAP timeline was detected, so it will play as a frozen frame. Send \"animate every element with staggered entrances and exits\" to bring it to life.",
			createdAt: new Date().toISOString(),
		},
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// --- Scene naming & length ----------------------------------------------------

const DEFAULT_SCENE_DURATION_SECS = 5;
const MIN_SCENE_LENGTH_SECS = 0.5;
const MAX_SCENE_LENGTH_SECS = 600;
const LENGTH_EPSILON_SECS = 0.001;

// --- Chat attachments -----------------------------------------------------------

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_MB = 6;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("read failed"));
		reader.readAsDataURL(file);
	});
}

function defaultRequestForImages(count: number): string {
	return `Use the attached reference image${count === 1 ? "" : "s"} as the visual ground truth and create or restyle the scene to match ${count === 1 ? "it" : "them"}.`;
}

function nextUniqueSceneName(existingNames: string[]): string {
	const base = "AI scene";
	const used = new Set(existingNames.map((name) => name.trim().toLowerCase()));
	if (!used.has(base.toLowerCase())) {
		return base;
	}
	let index = 1;
	while (used.has(`${base} (${index})`.toLowerCase())) {
		index += 1;
	}
	return `${base} (${index})`;
}

function formatLengthLabel(seconds: number): string {
	return String(Number.parseFloat(seconds.toFixed(3)));
}
