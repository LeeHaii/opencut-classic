import type { EditorCore } from "@/core";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/commands";
import {
	buildHyperframesElement,
	buildGraphicElement,
	buildElementFromMedia,
} from "@/timeline/element-utils";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME, type MediaTime } from "@/wasm";
import type { ElementAnimations, ScalarAnimationKey } from "@/animation/types";
import { buildSubtitleTextElement } from "@/subtitles/build-subtitle-text-element";
import type { SubtitleCue } from "@/subtitles/types";
import type { PlanScene, StockCandidate, StockProviderId } from "./types";
import { getRhymxTemplate } from "./motion/library";
import { searchStockMedia } from "./scenes/stock-search";
import { rankCandidates, scoreCandidate } from "./scenes/scoring";
import { MediaAcquirer } from "./scenes/acquirer";

export interface ApplyOptions {
	captionCues?: SubtitleCue[];
	signal?: AbortSignal;
	onProgress?: ({ done, total }: { done: number; total: number }) => void;
}

export interface ApplyResult {
	insertedMedia: number;
	insertedTemplates: number;
	insertedCaptions: number;
	skippedScenes: number;
}

/**
 * Applies an approved plan to the timeline as ONE undoable batch:
 * stock media (downloaded via MediaAcquirer) on video tracks, motion
 * templates on graphic tracks, and captions on a text track.
 */
export async function applyPlan({
	editor,
	scenes,
	options = {},
}: {
	editor: EditorCore;
	scenes: PlanScene[];
	options?: ApplyOptions;
}): Promise<ApplyResult> {
	const acquirer = new MediaAcquirer();
	const commands: Array<AddTrackCommand | InsertElementCommand> = [];

	let insertedMedia = 0;
	let insertedTemplates = 0;
	let skippedScenes = 0;
	const total = scenes.length;
	let done = 0;

	let videoTrackId: string | null = null;
	let graphicTrackId: string | null = null;

	for (const scene of scenes) {
		if (options.signal?.aborted) {
			break;
		}
		const startTime = mediaTimeFromSeconds({ seconds: scene.startTimeSec });
		let sceneDurationSec = scene.durationSec;
		let insertedSomething = false;

		if (scene.treatment === "motion") {
			if (
				scene.motionStatus === "ready" &&
				scene.motionHtml &&
				scene.motionHtml.trim().length > 0
			) {
				// AI-generated HyperFrames scene (preferred).
				const canvasSize = editor.project.getActive().settings.canvasSize;
				const element = buildHyperframesElement({
					compositionId: sanitizeCompositionId(scene.id),
					html: scene.motionHtml,
					name:
						scene.visualIntent.slice(0, 60) || `Motion #${scene.sceneNumber}`,
					startTime,
					duration: mediaTimeFromSeconds({ seconds: scene.durationSec }),
					width: canvasSize.width,
					height: canvasSize.height,
				});
				commands.push(
					new InsertElementCommand({
						element,
						placement: { mode: "auto" },
					}),
				);
				insertedTemplates += 1;
				insertedSomething = true;
			} else if (scene.templateId) {
				const template = getRhymxTemplate({ templateId: scene.templateId });
				if (template) {
					sceneDurationSec = Math.min(
						sceneDurationSec,
						template.meta.defaultDurationSec,
					);
					if (graphicTrackId === null) {
						const trackCommand = new AddTrackCommand({ type: "graphic" });
						graphicTrackId = trackCommand.getTrackId();
						commands.push(trackCommand);
					}
					const element = buildGraphicElement({
						definitionId: template.definition.id,
						name: template.meta.name,
						startTime,
					});
					element.duration = mediaTimeFromSeconds({
						seconds: sceneDurationSec,
					});
					commands.push(
						new InsertElementCommand({
							element,
							placement: { mode: "explicit", trackId: graphicTrackId },
						}),
					);
					insertedTemplates += 1;
					insertedSomething = true;
				}
			}
		} else if (scene.selectedCandidateId) {
			const candidate =
				scene.candidates.find(
					(item) => item.id === scene.selectedCandidateId,
				) ?? null;
			if (candidate) {
				const acquired = await acquirer.acquire({ editor, candidate });
				if (candidate.durationSec != null && candidate.kind === "video") {
					sceneDurationSec = Math.min(sceneDurationSec, candidate.durationSec);
				}
				const element = buildElementFromMedia({
					mediaId: acquired.mediaId,
					mediaType: candidate.kind === "video" ? "video" : "image",
					name: candidate.landingUrl ?? candidate.id,
					duration: mediaTimeFromSeconds({ seconds: sceneDurationSec }),
					startTime,
				});
				if (candidate.kind === "image") {
					element.animations = kenBurnsAnimation({
						durationSec: sceneDurationSec,
					});
				}
				if (videoTrackId === null) {
					const trackCommand = new AddTrackCommand({ type: "video" });
					videoTrackId = trackCommand.getTrackId();
					commands.push(trackCommand);
				}
				commands.push(
					new InsertElementCommand({
						element,
						placement: { mode: "explicit", trackId: videoTrackId },
					}),
				);
				insertedMedia += 1;
				insertedSomething = true;
			}
		}

		if (!insertedSomething) {
			skippedScenes += 1;
		}
		done += 1;
		options.onProgress?.({ done, total });
	}

	let insertedCaptions = 0;
	if (
		options.captionCues &&
		options.captionCues.length > 0 &&
		!options.signal?.aborted
	) {
		const textTrackCommand = new AddTrackCommand({ type: "text", index: 0 });
		const canvasSize = editor.project.getActive().settings.canvasSize;
		commands.unshift(textTrackCommand);
		options.captionCues.forEach((cue, index) => {
			commands.push(
				new InsertElementCommand({
					placement: {
						mode: "explicit",
						trackId: textTrackCommand.getTrackId(),
					},
					element: buildSubtitleTextElement({
						index,
						caption: cue,
						canvasSize,
					}),
				}),
			);
			insertedCaptions += 1;
		});
	}

	if (commands.length > 0) {
		editor.command.execute({ command: new BatchCommand(commands) });
	}

	return { insertedMedia, insertedTemplates, insertedCaptions, skippedScenes };
}

function kenBurnsAnimation({
	durationSec,
}: {
	durationSec: number;
}): ElementAnimations {
	return {
		"transform.scaleX": {
			keys: [
				scalarKey({ time: ZERO_MEDIA_TIME, value: 1, isLast: false }),
				scalarKey({
					time: mediaTimeFromSeconds({ seconds: durationSec }),
					value: 1.12,
					isLast: true,
				}),
			],
		},
		"transform.scaleY": {
			keys: [
				scalarKey({ time: ZERO_MEDIA_TIME, value: 1, isLast: false }),
				scalarKey({
					time: mediaTimeFromSeconds({ seconds: durationSec }),
					value: 1.12,
					isLast: true,
				}),
			],
		},
	};
}

let keyframeCounter = 0;

function scalarKey({
	time,
	value,
	isLast,
}: {
	time: MediaTime;
	value: number;
	isLast: boolean;
}): ScalarAnimationKey {
	keyframeCounter += 1;
	return {
		id: `rhymx-kb-${keyframeCounter}`,
		time,
		value,
		segmentToNext: isLast ? "linear" : "linear",
		tangentMode: "auto",
	};
}

/** Runs stock matching for one scene: search providers + rank candidates. */
export async function findSceneCandidates({
	query,
	providers,
	targetDurationSec,
	pexelsKey,
	pixabayKey,
	providerUsage,
	signal,
}: {
	query: string;
	providers: StockProviderId[];
	targetDurationSec: number;
	pexelsKey: string;
	pixabayKey: string;
	providerUsage?: Map<StockProviderId, number>;
	signal?: AbortSignal;
}): Promise<{ ranked: StockCandidate[]; topScore: number }> {
	const { candidates } = await searchStockMedia({
		query: { query, providers, kind: "all" },
		context: { pexelsKey, pixabayKey, signal },
	});
	const queryTerms = tokenize(query);
	const ranked = rankCandidates({
		candidates,
		context: { queryTerms, targetDurationSec, providerUsage },
		limit: 4,
	});
	const topScore = ranked[0]
		? scoreCandidate({
				candidate: ranked[0],
				context: { queryTerms, targetDurationSec, providerUsage },
			})
		: 0;
	return { ranked, topScore };
}

function tokenize(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function sanitizeCompositionId(sceneId: string): string {
	const clean = sceneId.replace(/[^a-zA-Z0-9-]/g, "");
	return `rhymx-${clean || "scene"}`;
}
