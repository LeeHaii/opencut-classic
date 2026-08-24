"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	ExternalLink,
	Film,
	SendHorizontal,
	Sparkles,
	UserRound,
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
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import { renderHyperframesElement } from "../render-element";
import { runBrowserHyperframesAgent } from "../browser-agent";
import { useHyperframesPanelStore } from "../store";
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
		const element = buildHyperframesElement({
			compositionId,
			startTime: editor.playback.getCurrentTime(),
			duration: mediaTimeFromSeconds({ seconds: 5 }),
			width,
			height,
		});
		editor.timeline.insertElement({ element, placement: { mode: "auto" } });
	}, [editor]);

	const handleSend = async (request: string) => {
		const entry = activeEntry;
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
					},
				});
				return;
			}

			const controller = new AbortController();
			browserRuns.current.set(element.id, controller);
			const text = await runBrowserHyperframesAgent({
				prompt,
				apiKey: loadApiKeys().groq || undefined,
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

	return (
		<PanelView title="AI Motion" contentClassName="h-full">
			<div className="flex min-h-full flex-col gap-3 pb-5">
				{!native && (
					<div className="border-border/70 bg-muted/35 text-muted-foreground rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed">
						<div className="text-foreground mb-1 flex items-center gap-1.5 font-medium">
							<Sparkles className="size-3.5" /> Browser AI
						</div>
						Groq generates the scene; OpenCut renders HTML/CSS/GSAP locally with
						WebCodecs.
					</div>
				)}

				{native && status && (
					<div className="border-border/70 bg-muted/30 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[11px]">
						<div
							className={cn(
								"flex size-7 shrink-0 items-center justify-center rounded-full",
								status.installed
									? "bg-emerald-500/12 text-emerald-600"
									: "bg-destructive/10 text-destructive",
							)}
						>
							{status.installed ? (
								<CheckCircle2 className="size-3.5" />
							) : (
								<AlertTriangle className="size-3.5" />
							)}
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-foreground truncate font-medium">
								{status.installed
									? (status.accountEmail ?? "Antigravity CLI detected")
									: "Antigravity CLI not found"}
							</p>
							<p className="text-muted-foreground truncate text-[10px]">
								{status.installed
									? "Desktop agent ready"
									: "Install the CLI to generate scenes"}
							</p>
						</div>
						{status.installed && !status.minimumVersionMet && (
							<span className="text-destructive shrink-0 text-[10px]">
								Update CLI
							</span>
						)}
						{status.installed && !status.accountEmail && (
							<Button
								size="sm"
								variant="secondary"
								className="h-6 px-2 text-[10px]"
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
							"flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px]",
							nativeRenderStatus.node.found &&
								nativeRenderStatus.hyperframes_cli.found
								? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
								: "border-destructive/20 bg-destructive/5 text-destructive",
						)}
					>
						<Film className="size-3.5 shrink-0" />
						<span className="truncate">
							{nativeRenderStatus.node.found &&
							nativeRenderStatus.hyperframes_cli.found
								? `Renderer ready${nativeRenderStatus.hyperframes_cli.version ? ` · ${nativeRenderStatus.hyperframes_cli.version}` : ""}`
								: "Renderer setup is incomplete"}
						</span>
					</div>
				)}

				<Button className="w-full" onClick={insertScene}>
					<Sparkles className="size-4" />
					Add AI scene at playhead
				</Button>

				{hyperframesElements.length > 0 && (
					<div className="space-y-1.5">
						<p className="text-muted-foreground px-0.5 text-[10px] font-medium uppercase tracking-wide">
							Scene
						</p>
						<Select
							value={resolvedActiveElementId ?? ""}
							onValueChange={(value) => {
								setActiveElementId(value);
								setNativeActionError(null);
							}}
						>
							<SelectTrigger className="h-9 text-xs">
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
					</div>
				)}

				{activeEntry && (
					<>
						{native && status?.installed && (
							<div className="space-y-1.5">
								<p className="text-muted-foreground px-0.5 text-[10px] font-medium uppercase tracking-wide">
									Model
								</p>
								<Select
									value={store.model}
									onValueChange={(value) => store.setModel(value)}
								>
									<SelectTrigger className="h-9 text-xs">
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
								<p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
									Conversation
								</p>
								<span className="text-muted-foreground text-[10px]">
									{chat.length} {chat.length === 1 ? "message" : "messages"}
								</span>
							</div>
							<ChatHistory messages={chat} />
						</div>

						{run?.running && (
							<div className="border-primary/20 bg-primary/5 text-muted-foreground flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]">
								<Spinner className="size-3.5" />
								<span className="truncate font-mono">
									{run.streamLine ?? "Working…"}
								</span>
								<Button
									variant="ghost"
									size="sm"
									className="ml-auto h-6 px-2 text-[10px]"
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
							onSubmit={(value) => void handleSend(value)}
						/>

						{nativeActionError && (
							<div className="border-destructive/25 bg-destructive/8 text-destructive flex gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed">
								<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
								<span>{nativeActionError}</span>
							</div>
						)}

						<div className="grid grid-cols-2 gap-2 border-t pt-3">
							{native ? (
								<Button
									variant="default"
									className="min-w-0 px-2 text-xs"
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
								<p className="text-muted-foreground col-span-2 px-1 text-[11px]">
									No pre-render needed: Export renders this scene locally in the
									browser.
								</p>
							)}
							<Button
								variant="outline"
								className="min-w-0 px-2 text-xs"
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

function ChatHistory({ messages }: { messages: AgentChatMessage[] }) {
	if (messages.length === 0) {
		return (
			<div className="border-border/70 bg-muted/20 flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed px-5 py-6 text-center">
				<div className="bg-primary/10 text-primary mb-2 flex size-8 items-center justify-center rounded-full">
					<Bot className="size-4" />
				</div>
				<p className="text-foreground text-xs font-medium">Build with AI</p>
				<p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
					Describe a title, data card, transition, or complete motion scene.
				</p>
			</div>
		);
	}
	return (
		<div className="border-border/70 bg-muted/15 flex max-h-[34vh] min-h-32 flex-col gap-3 overflow-y-auto rounded-xl border p-2.5">
			{messages.map((message) => {
				if (message.role === "system") {
					return (
						<div
							key={message.id}
							className="border-destructive/20 bg-destructive/8 text-destructive flex gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed"
						>
							<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
							<span className="whitespace-pre-wrap">{message.text}</span>
						</div>
					);
				}
				const user = message.role === "user";
				return (
					<div
						key={message.id}
						className={cn("flex gap-2", user && "flex-row-reverse")}
					>
						<div
							className={cn(
								"mt-4 flex size-6 shrink-0 items-center justify-center rounded-full",
								user
									? "bg-primary text-primary-foreground"
									: "bg-foreground text-background",
							)}
						>
							{user ? (
								<UserRound className="size-3" />
							) : (
								<Bot className="size-3" />
							)}
						</div>
						<div className={cn("max-w-[82%]", user && "text-right")}>
							<p className="text-muted-foreground mb-1 px-1 text-[9px] font-medium uppercase tracking-wide">
								{user ? "You" : "Antigravity"}
							</p>
							<div
								className={cn(
									"whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-[11px] leading-relaxed",
									user
										? "bg-primary text-primary-foreground rounded-tr-sm"
										: "bg-background border-border/70 rounded-tl-sm border",
								)}
							>
								{message.text}
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function PromptInput({
	disabled,
	onSubmit,
}: {
	disabled: boolean;
	onSubmit: (value: string) => void;
}) {
	const [value, setValue] = useState("");
	const submit = () => {
		const trimmed = value.trim();
		if (!trimmed) return;
		onSubmit(trimmed);
		setValue("");
	};
	return (
		<form
			className="border-border/70 bg-background rounded-xl border p-2 shadow-xs"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<Textarea
				value={value}
				placeholder="Describe what to create or change…"
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						submit();
					}
				}}
				className="bg-transparent min-h-16 resize-none border-0 p-1.5 text-xs shadow-none focus-visible:border-0"
				disabled={disabled}
			/>
			<div className="mt-1 flex items-center justify-between gap-2">
				<span className="text-muted-foreground pl-1 text-[9px]">
					Shift + Enter for a new line
				</span>
				<Button
					type="submit"
					size="sm"
					className="h-7 px-2.5 text-[11px]"
					disabled={disabled || !value.trim()}
				>
					<SendHorizontal className="size-3.5" />
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
