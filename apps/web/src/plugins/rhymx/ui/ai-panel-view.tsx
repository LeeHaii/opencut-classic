"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/editor/use-editor";
import { frameRateToFloat } from "@/fps/utils";
import { processMediaAssets } from "@/media/processing";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@/wasm";
import { AlertTriangle, CheckCircle2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { PlanScene, StockCandidate, StockProviderId } from "../types";
import { buildCaptionCues } from "../captions/modes";
import { extractKeywords } from "../ai/keyword-heuristics";
import { planScenes } from "../ai/plan-client";
import { transcribeVoiceover } from "../ai/transcribe";
import { generateMotionSceneHtml } from "../ai/motion-generator";
import {
	segmentTranscriptSegments,
	segmentWords,
} from "../scenes/segmentation";
import { applyPlan, findSceneCandidates } from "../orchestrator";
import { suggestTemplateForScene } from "../motion/library";
import { useRhymxStore } from "../state/rhymx-store";

const MOTION_CONCURRENCY = 2;

function segmentFromWords(
	words: Array<{ word: string; start: number; end: number }>,
) {
	return segmentWords({
		words: words.map((word) => ({
			text: word.word,
			startSec: word.start,
			endSec: word.end,
		})),
	});
}

function segmentFallback(
	segments: Array<{ text: string; start: number; end: number }>,
) {
	return segmentTranscriptSegments({ segments });
}

export function AiGeneratorView({ onComplete }: { onComplete?: () => void }) {
	const editor = useEditor();
	const store = useRhymxStore();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [sourceAudioFile, setSourceAudioFile] = useState<File | null>(null);
	const [sourceAudioAssetId, setSourceAudioAssetId] = useState<string | null>(
		null,
	);
	const [sourceAudioAttached, setSourceAudioAttached] = useState(false);
	const [showSettings, setShowSettings] = useState(false);

	useEffect(() => {
		useRhymxStore.getState().reset();
		return () => {
			useRhymxStore.getState().reset();
		};
	}, []);

	const busy =
		store.step === "transcribing" ||
		store.step === "planning" ||
		store.step === "generating" ||
		store.step === "matching" ||
		store.step === "applying";

	const mediaScenes = useMemo(
		() => store.scenes.filter((scene) => scene.treatment === "media"),
		[store.scenes],
	);

	const pendingMotionSceneIds = useMemo(
		() =>
			store.scenes
				.filter(
					(scene) =>
						scene.treatment === "motion" && scene.motionStatus !== "ready",
				)
				.map((scene) => scene.id),
		[store.scenes],
	);

	const handlePickFile = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const analyzeVoiceover = useCallback(
		async (file: File) => {
			store.reset();
			store.setStep({ step: "transcribing" });
			try {
				const transcription = await transcribeVoiceover({
					file,
					apiKey: store.keys.groq || undefined,
					language: store.language || undefined,
				});
				store.setStatusMessage({ message: "Planning scenes with AI…" });
				store.setStep({ step: "planning" });

				const words = transcription.words;
				const scenes =
					words.length > 0
						? segmentFromWords(words)
						: segmentFallback(transcription.segments);
				if (scenes.length === 0) {
					throw new Error("Could not detect any scenes in this audio");
				}

				const requestScenes = scenes.map((scene) => ({
					id: scene.id,
					sceneNumber: scene.sceneNumber,
					transcriptText: scene.transcriptText,
					previousScene: scenes[scene.sceneNumber - 2]?.transcriptText ?? null,
					nextScene: scenes[scene.sceneNumber]?.transcriptText ?? null,
				}));

				const planned = await planScenes({
					fullNarration: transcription.text,
					requestScenes,
					apiKey: store.keys.groq || undefined,
				});

				const merged: PlanScene[] = scenes.map((scene) => {
					const plan = planned.find((item) => item.id === scene.id);
					return {
						...scene,
						visualIntent: plan?.visualIntent ?? "",
						keywords:
							plan?.keywords ??
							extractKeywords({ transcript: scene.transcriptText }),
						treatment: plan?.treatment ?? "media",
						templateId: undefined,
						candidates: [],
						selectedCandidateId: null,
						matchStatus: "idle",
					};
				});
				for (const scene of merged) {
					if (scene.treatment === "motion") {
						scene.templateId = suggestTemplateForScene({
							visualIntent: scene.visualIntent,
							keywords: scene.keywords,
						});
					}
				}

				store.setFullNarration({ narration: transcription.text });
				store.setScenes({ scenes: merged });
				store.setStep({ step: "reviewing" });
				store.setStatusMessage({ message: null });
			} catch (error) {
				store.setError({
					error:
						error instanceof Error
							? error.message
							: "Something went wrong while analyzing the audio",
				});
				store.setStep({ step: "idle" });
			}
		},
		[store],
	);

	const handleFile = useCallback(
		(file: File | undefined) => {
			if (!file) return;
			setSourceAudioFile(file);
			setSourceAudioAssetId(null);
			setSourceAudioAttached(false);
			store.reset();
		},
		[store],
	);

	/**
	 * Generates HyperFrames motion scenes for the given planned scenes with
	 * bounded concurrency. Falls back to the selected template at apply time
	 * for scenes that end up not ready.
	 */
	const handleGenerateMotion = useCallback(
		async ({ sceneIds }: { sceneIds: string[] }) => {
			const settings = editor.project.getActiveOrNull()?.settings;
			const projectId = editor.project.getActiveOrNull()?.metadata.id;
			if (!settings || !projectId || sceneIds.length === 0) return;

			const width = settings.canvasSize.width;
			const height = settings.canvasSize.height;
			const fps = Math.round(frameRateToFloat(settings.fps));
			const apiKey = useRhymxStore.getState().keys.groq || undefined;

			store.setStep({ step: "generating" });
			store.setStatusMessage({ message: null });

			const scenesById = new Map(
				useRhymxStore.getState().scenes.map((scene) => [scene.id, scene]),
			);
			const queue = sceneIds
				.map((sceneId) => scenesById.get(sceneId))
				.filter((scene): scene is PlanScene => Boolean(scene));

			let cursor = 0;
			const worker = async () => {
				while (cursor < queue.length) {
					const scene = queue[cursor];
					cursor += 1;
					if (!scene) return;

					useRhymxStore.getState().updateScene({
						sceneId: scene.id,
						patch: { motionStatus: "generating", motionError: undefined },
					});
					try {
						const { html } = await generateMotionSceneHtml({
							scene: {
								sceneNumber: scene.sceneNumber,
								visualIntent: scene.visualIntent,
								keywords: scene.keywords,
								transcriptText: scene.transcriptText,
								durationSec: scene.durationSec,
							},
							context: { projectId, width, height, fps, apiKey },
						});
						useRhymxStore.getState().updateScene({
							sceneId: scene.id,
							patch: { motionStatus: "ready", motionHtml: html },
						});
					} catch (error) {
						useRhymxStore.getState().updateScene({
							sceneId: scene.id,
							patch: {
								motionStatus: "failed",
								motionError:
									error instanceof Error
										? error.message
										: "Motion generation failed",
							},
						});
					}
				}
			};

			try {
				await Promise.all(
					Array.from(
						{ length: Math.min(MOTION_CONCURRENCY, queue.length) },
						() => worker(),
					),
				);
				const failed = useRhymxStore
					.getState()
					.scenes.filter((scene) => scene.motionStatus === "failed").length;
				if (failed > 0) {
					toast.warning(`${failed} motion scene(s) failed to generate`, {
						description: "Those scenes will use their selected template.",
					});
				} else {
					toast.success("AI motion scenes ready");
				}
			} finally {
				useRhymxStore.getState().setStep({ step: "reviewing" });
			}
		},
		[editor, store],
	);

	const handleFindMatches = useCallback(async () => {
		const providers: StockProviderId[] = [
			...(store.keys.pexels ? (["pexels"] as const) : []),
			...(store.keys.pixabay ? (["pixabay"] as const) : []),
			"wikimedia",
			"archive",
			"nasa",
		];
		store.setStep({ step: "matching" });
		store.setProgress({ done: 0, total: mediaScenes.length });
		const providerUsage = new Map<StockProviderId, number>();

		for (let index = 0; index < mediaScenes.length; index++) {
			const scene = mediaScenes[index];
			store.updateScene({
				sceneId: scene.id,
				patch: { matchStatus: "searching" },
			});
			try {
				let { ranked, topScore } = await findSceneCandidates({
					query: scene.keywords[0] ?? scene.transcriptText.slice(0, 60),
					providers,
					targetDurationSec: scene.durationSec,
					pexelsKey: store.keys.pexels,
					pixabayKey: store.keys.pixabay,
					providerUsage,
				});
				if (
					ranked.length === 0 &&
					scene.keywords[1] &&
					scene.keywords[1] !== scene.keywords[0]
				) {
					({ ranked, topScore } = await findSceneCandidates({
						query: scene.keywords[1],
						providers,
						targetDurationSec: scene.durationSec,
						pexelsKey: store.keys.pexels,
						pixabayKey: store.keys.pixabay,
						providerUsage,
					}));
				}
				for (const candidate of ranked) {
					providerUsage.set(
						candidate.provider,
						(providerUsage.get(candidate.provider) ?? 0) + 1,
					);
				}
				store.updateScene({
					sceneId: scene.id,
					patch: {
						candidates: ranked,
						selectedCandidateId: ranked[0]?.id ?? null,
						matchStatus: ranked.length > 0 ? "ready" : "failed",
					},
				});
				void topScore;
			} catch (error) {
				store.updateScene({
					sceneId: scene.id,
					patch: { matchStatus: "failed" },
				});
				console.warn("[rhymx] match failed", error);
			}
			store.setProgress({ done: index + 1, total: mediaScenes.length });
		}
		store.setStep({ step: "reviewing" });
	}, [mediaScenes, store]);

	const handleApply = useCallback(async () => {
		if (!sourceAudioFile) {
			store.setError({ error: "Choose an audio file before generating" });
			return;
		}
		store.setStep({ step: "applying" });
		try {
			const project = editor.project.getActive();
			let audioAssetId = sourceAudioAssetId;
			let audioDurationSec: number | undefined;

			if (!audioAssetId) {
				const [processedAudio] = await processMediaAssets({
					files: [sourceAudioFile],
				});
				if (!processedAudio || processedAudio.type !== "audio") {
					throw new Error("The selected file could not be imported as audio");
				}
				const addedAudio = await editor.media.addMediaAsset({
					projectId: project.metadata.id,
					asset: processedAudio,
				});
				if (!addedAudio) {
					throw new Error("Could not save the voiceover to this project");
				}
				audioAssetId = addedAudio.id;
				audioDurationSec = addedAudio.duration;
				setSourceAudioAssetId(addedAudio.id);
			} else {
				audioDurationSec = editor.media
					.getAssets()
					.find((asset) => asset.id === audioAssetId)?.duration;
			}

			if (!sourceAudioAttached) {
				const durationSec =
					audioDurationSec ??
					Math.max(0.1, ...store.scenes.map((scene) => scene.endTimeSec));
				editor.timeline.insertElement({
					element: buildElementFromMedia({
						mediaId: audioAssetId,
						mediaType: "audio",
						name: sourceAudioFile.name,
						duration: mediaTimeFromSeconds({ seconds: durationSec }),
						startTime: ZERO_MEDIA_TIME,
					}),
					placement: { mode: "auto" },
				});
				setSourceAudioAttached(true);
			}

			const captionCues = store.includeCaptions
				? buildCaptionCues({ scenes: store.scenes, mode: store.captionMode })
				: [];
			const result = await applyPlan({
				editor,
				scenes: store.scenes,
				options: {
					captionCues,
					onProgress: ({ done, total }) => store.setProgress({ done, total }),
				},
			});
			toast.success("AI edit applied", {
				description: `${result.insertedMedia} clips · ${result.insertedTemplates} motion graphics · ${result.insertedCaptions} captions${result.skippedScenes > 0 ? ` · ${result.skippedScenes} skipped` : ""}`,
			});
			await editor.save.flush();
			store.reset();
			onComplete?.();
		} catch (error) {
			store.setError({
				error: error instanceof Error ? error.message : "Apply failed",
			});
			store.setStep({ step: "reviewing" });
		}
	}, [
		editor,
		onComplete,
		sourceAudioAssetId,
		sourceAudioAttached,
		sourceAudioFile,
		store,
	]);

	const readyToApply =
		store.scenes.length > 0 &&
		store.scenes.every(
			(scene) =>
				scene.treatment === "motion" ||
				scene.selectedCandidateId !== null ||
				scene.matchStatus !== "ready",
		);

	return (
		<PanelView
			title="AI Editor"
			actions={
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setShowSettings((value) => !value)}
				>
					Keys
				</Button>
			}
		>
			<div className="flex flex-col gap-3 pb-6">
				{showSettings && <SettingsSection />}

				<input
					ref={fileInputRef}
					type="file"
					accept="audio/*"
					className="hidden"
					onChange={(event) => {
						handleFile(event.target.files?.[0]);
						event.target.value = "";
					}}
				/>

				{store.step === "idle" && !store.error && (
					<div className="text-muted-foreground flex flex-col gap-2 px-1 text-xs">
						<p>
							Choose a voiceover file and the AI plans your video: it
							transcribes, splits scenes, picks stock footage or motion
							graphics, and lays everything on the timeline.
						</p>
					</div>
				)}

				{(store.step === "idle" || store.step === "reviewing") && (
					<div className="flex flex-col gap-2">
						<div className="flex flex-col gap-1">
							<Label className="text-[11px]">Source audio</Label>
							<button
								type="button"
								className="border-input bg-background hover:bg-accent flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs disabled:opacity-50"
								onClick={handlePickFile}
								disabled={busy}
							>
								<span className="min-w-0 truncate">
									{sourceAudioFile?.name ?? "Browse for an audio file"}
								</span>
								<span className="text-muted-foreground shrink-0">
									{sourceAudioFile ? "Replace" : "Browse"}
								</span>
							</button>
						</div>
						<div className="flex items-end gap-2">
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<Label className="text-[11px]">Language</Label>
								<Select
									value={store.language || "auto"}
									onValueChange={(value) =>
										store.setLanguage({
											language: value === "auto" ? "" : value,
										})
									}
									disabled={busy}
								>
									<SelectTrigger className="h-8 text-xs">
										<SelectValue placeholder="Auto-detect" />
									</SelectTrigger>
									<SelectContent>
										{TRANSCRIPTION_LANGUAGES.map((language) => (
											<SelectItem
												key={language.code || "auto"}
												value={language.code || "auto"}
											>
												{language.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<Button
								className="flex-1"
								onClick={() =>
									sourceAudioFile && void analyzeVoiceover(sourceAudioFile)
								}
								disabled={busy || !sourceAudioFile}
							>
								{store.scenes.length > 0 ? "Re-analyze audio" : "Generate plan"}
							</Button>
						</div>
					</div>
				)}

				{busy && (
					<div className="flex items-center gap-2 px-1 text-xs">
						<Spinner className="size-4" />
						<span>
							{stepLabel(store.step)}
							{store.progressTotal > 0 &&
								` (${store.progressDone}/${store.progressTotal})`}
						</span>
					</div>
				)}

				{store.error && (
					<div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs">
						{store.error}
					</div>
				)}
				{store.statusMessage && !busy && (
					<div className="text-muted-foreground px-1 text-xs">
						{store.statusMessage}
					</div>
				)}

				{store.step === "reviewing" && (
					<>
						<div className="flex gap-2">
							<Button
								className="flex-1"
								onClick={() => void handleFindMatches()}
								disabled={busy || mediaScenes.length === 0}
							>
								Find stock matches
							</Button>
							<Button
								className="flex-1"
								variant="outline"
								onClick={() =>
									void handleGenerateMotion({
										sceneIds: pendingMotionSceneIds,
									})
								}
								disabled={busy || pendingMotionSceneIds.length === 0}
							>
								<Sparkles className="size-3.5" />
								Generate motion
							</Button>
							<Button
								className="flex-1"
								onClick={() => void handleApply()}
								disabled={busy || !readyToApply}
							>
								Apply to timeline
							</Button>
						</div>
						<SceneReviewList onGenerateMotion={handleGenerateMotion} />
						<div className="mt-2 flex flex-col gap-2 border-t pt-3">
							<CaptionOptions />
							<div className="flex gap-2">
								<Button
									className="flex-1"
									onClick={() => void handleFindMatches()}
									disabled={busy || mediaScenes.length === 0}
								>
									Find stock matches
								</Button>
								<Button
									className="flex-1"
									variant="outline"
									onClick={() =>
										void handleGenerateMotion({
											sceneIds: pendingMotionSceneIds,
										})
									}
									disabled={busy || pendingMotionSceneIds.length === 0}
								>
									<Sparkles className="size-3.5" />
									Generate motion
								</Button>
								<Button
									className="flex-1"
									onClick={() => void handleApply()}
									disabled={busy || !readyToApply}
								>
									Apply to timeline
								</Button>
							</div>
							{!readyToApply && (
								<span className="text-muted-foreground px-1 text-[11px]">
									Pick a candidate for each matched scene, or set its treatment
									to Motion / skip matching.
								</span>
							)}
						</div>
					</>
				)}
			</div>
		</PanelView>
	);
}

function stepLabel(step: string): string {
	switch (step) {
		case "transcribing":
			return "Transcribing voiceover…";
		case "planning":
			return "Planning visuals…";
		case "generating":
			return "Generating AI motion scenes…";
		case "matching":
			return "Searching stock libraries…";
		case "applying":
			return "Building timeline…";
		default:
			return "Working…";
	}
}

function SettingsSection() {
	const store = useRhymxStore();

	return (
		<div className="flex flex-col gap-2 rounded-md border p-3">
			<span className="text-xs font-medium">
				Provider keys (stored locally)
			</span>
			{(["groq", "pexels", "pixabay"] as const).map((provider) => (
				<div key={provider} className="flex flex-col gap-1">
					<Label className="text-[11px] capitalize">{provider}</Label>
					<Input
						type="password"
						placeholder={`${provider} API key`}
						value={store.keys[provider]}
						onChange={(event) =>
							store.updateKey({ key: provider, value: event.target.value })
						}
						className="h-8 text-xs"
					/>
				</div>
			))}
			<span className="text-muted-foreground text-[10px]">
				Wikimedia, Archive.org and NASA need no keys. Groq powers transcription
				and planning.
			</span>
		</div>
	);
}

function SceneReviewList({
	onGenerateMotion,
}: {
	onGenerateMotion: (args: { sceneIds: string[] }) => Promise<void>;
}) {
	const scenes = useRhymxStore((state) => state.scenes);

	return (
		<div className="flex flex-col gap-2">
			{scenes.map((scene) => (
				<SceneCard
					key={scene.id}
					scene={scene}
					onGenerateMotion={onGenerateMotion}
				/>
			))}
		</div>
	);
}

function SceneCard({
	scene,
	onGenerateMotion,
}: {
	scene: PlanScene;
	onGenerateMotion: (args: { sceneIds: string[] }) => Promise<void>;
}) {
	const store = useRhymxStore();

	return (
		<div className="flex flex-col gap-2 rounded-md border p-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-muted-foreground text-[11px]">
					#{scene.sceneNumber} · {formatTime(scene.startTimeSec)}–
					{formatTime(scene.endTimeSec)}
				</span>
				<Select
					value={scene.treatment}
					onValueChange={(value) => {
						const treatment: PlanScene["treatment"] | null =
							value === "motion"
								? "motion"
								: value === "media"
									? "media"
									: null;
						if (!treatment) {
							return;
						}
						store.updateScene({
							sceneId: scene.id,
							patch: { treatment },
						});
					}}
				>
					<SelectTrigger className="h-7 w-[110px] text-[11px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="media">Stock media</SelectItem>
						<SelectItem value="motion">Motion graphic</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<Input
				value={scene.visualIntent}
				placeholder="Visual intent"
				onChange={(event) =>
					store.updateScene({
						sceneId: scene.id,
						patch: { visualIntent: event.target.value },
					})
				}
				className="h-8 text-xs"
			/>

			<Input
				value={scene.keywords.join(", ")}
				placeholder="Search keywords"
				onChange={(event) =>
					store.updateScene({
						sceneId: scene.id,
						patch: {
							keywords: event.target.value
								.split(",")
								.map((keyword) => keyword.trim())
								.filter(Boolean),
						},
					})
				}
				className="h-8 text-xs"
			/>

			<p className="text-muted-foreground line-clamp-2 text-[10px] italic">
				“{scene.transcriptText}”
			</p>

			{scene.treatment === "motion" && (
				<MotionGenerationRow
					scene={scene}
					onGenerate={() => void onGenerateMotion({ sceneIds: [scene.id] })}
				/>
			)}

			{scene.treatment === "media" && scene.candidates.length > 0 && (
				<div className="grid grid-cols-4 gap-1">
					{scene.candidates.map((candidate) => (
						<CandidateThumb
							key={candidate.id}
							candidate={candidate}
							selected={scene.selectedCandidateId === candidate.id}
							onSelect={() =>
								store.updateScene({
									sceneId: scene.id,
									patch: { selectedCandidateId: candidate.id },
								})
							}
						/>
					))}
				</div>
			)}
			{scene.treatment === "media" && scene.matchStatus === "failed" && (
				<Badge variant="outline" className="w-fit text-[10px]">
					No matches — will be skipped
				</Badge>
			)}
		</div>
	);
}

function MotionGenerationRow({
	scene,
	onGenerate,
}: {
	scene: PlanScene;
	onGenerate: () => void;
}) {
	const status = scene.motionStatus ?? "idle";

	if (status === "generating") {
		return (
			<div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
				<Spinner className="size-3" />
				Generating AI motion…
			</div>
		);
	}
	if (status === "ready") {
		return (
			<div className="flex items-center justify-between gap-2">
				<span className="flex items-center gap-1.5 text-[11px] text-emerald-600">
					<CheckCircle2 className="size-3" />
					AI motion scene ready
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-5 rounded px-1.5 text-[9px]"
					onClick={onGenerate}
				>
					<RefreshCw className="size-2.5" />
					Regenerate
				</Button>
			</div>
		);
	}
	if (status === "failed") {
		return (
			<div className="flex flex-col gap-1">
				<span className="text-destructive flex items-center gap-1.5 text-[11px]">
					<AlertTriangle className="size-3" />
					{scene.motionError ?? "Generation failed"}
				</span>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						className="h-5 rounded px-1.5 text-[9px]"
						onClick={onGenerate}
					>
						Retry
					</Button>
					<span className="text-muted-foreground text-[10px]">
						Falls back to the template if skipped.
					</span>
				</div>
			</div>
		);
	}
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-muted-foreground text-[10px]">
				Uses the fallback template unless generated.
			</span>
			<Button
				variant="ghost"
				size="sm"
				className="text-primary h-5 rounded px-1.5 text-[9px]"
				onClick={onGenerate}
			>
				<Sparkles className="size-2.5" />
				Generate with AI
			</Button>
		</div>
	);
}

function CandidateThumb({
	candidate,
	selected,
	onSelect,
}: {
	candidate: StockCandidate;
	selected: boolean;
	onSelect: () => void;
}) {
	const setPreviewCandidate = useRhymxStore(
		(state) => state.setPreviewCandidate,
	);

	return (
		<button
			type="button"
			onClick={() => {
				onSelect();
				setPreviewCandidate({ candidate });
			}}
			title={`Select · click to preview on the right${candidate.creator ? ` · ${candidate.creator}` : ""}`}
			className={`overflow-hidden rounded border-2 transition-colors ${
				selected ? "border-primary" : "border-transparent hover:border-border"
			}`}
		>
			{candidate.thumbnailUrl ? (
				<img
					src={candidate.thumbnailUrl}
					alt={candidate.id}
					className="aspect-video w-full object-cover"
					referrerPolicy="no-referrer"
					loading="lazy"
				/>
			) : (
				<span className="text-muted-foreground flex aspect-video items-center justify-center text-[9px]">
					{candidate.provider}
				</span>
			)}
		</button>
	);
}

function CaptionOptions() {
	const includeCaptions = useRhymxStore((state) => state.includeCaptions);
	const captionMode = useRhymxStore((state) => state.captionMode);
	const setIncludeCaptions = useRhymxStore((state) => state.setIncludeCaptions);
	const setCaptionMode = useRhymxStore((state) => state.setCaptionMode);

	return (
		<div className="flex items-center justify-between gap-2 px-1">
			<span className="flex items-center gap-2 text-xs">
				<Switch
					checked={includeCaptions}
					onCheckedChange={(value) => setIncludeCaptions({ value })}
					aria-label="Include captions"
				/>
				Captions
			</span>
			<Select
				value={captionMode}
				onValueChange={(value) => {
					const mode: typeof captionMode | null =
						value === "sentence"
							? "sentence"
							: value === "phrase"
								? "phrase"
								: value === "word"
									? "word"
									: value === "keywords"
										? "keywords"
										: null;
					if (!mode) {
						return;
					}
					setCaptionMode({ mode });
				}}
				disabled={!includeCaptions}
			>
				<SelectTrigger className="h-7 w-[130px] text-[11px]">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="sentence">Sentence</SelectItem>
					<SelectItem value="phrase">Phrase (3 words)</SelectItem>
					<SelectItem value="word">Word</SelectItem>
					<SelectItem value="keywords">Keywords</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function formatTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const rest = Math.floor(seconds % 60);
	return `${minutes}:${String(rest).padStart(2, "0")}`;
}

const TRANSCRIPTION_LANGUAGES: Array<{ code: string; label: string }> = [
	{ code: "", label: "Auto-detect" },
	{ code: "en", label: "English" },
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "de", label: "German" },
	{ code: "it", label: "Italian" },
	{ code: "pt", label: "Portuguese" },
	{ code: "nl", label: "Dutch" },
	{ code: "pl", label: "Polish" },
	{ code: "ru", label: "Russian" },
	{ code: "tr", label: "Turkish" },
	{ code: "ar", label: "Arabic" },
	{ code: "hi", label: "Hindi" },
	{ code: "ur", label: "Urdu" },
	{ code: "bn", label: "Bengali" },
	{ code: "id", label: "Indonesian" },
	{ code: "vi", label: "Vietnamese" },
	{ code: "th", label: "Thai" },
	{ code: "zh", label: "Chinese" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
];
