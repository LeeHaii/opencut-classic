import { describe, expect, test } from "bun:test";
import { parseScenePlan } from "../ai/scene-planner";
import { buildCaptionCues } from "../captions/modes";
import { rankCandidates, scoreCandidate } from "../scenes/scoring";
import {
	segmentTranscriptSegments,
	segmentWords,
} from "../scenes/segmentation";
import type { PlanScene, StockCandidate } from "../types";

function candidate({
	id,
	provider,
	kind = "video",
	width = 1920,
	height = 1080,
	durationSec = 8,
}: {
	id: string;
	provider: StockCandidate["provider"];
	kind?: StockCandidate["kind"];
	width?: number;
	height?: number;
	durationSec?: number;
}): StockCandidate {
	return {
		id,
		provider,
		kind,
		sourceUrl: `https://example.test/${id}`,
		landingUrl: `https://example.test/space-launch/${id}`,
		width,
		height,
		durationSec,
		licenseName: "test",
	};
}

describe("Rhymx scene segmentation", () => {
	test("flushes a scene at a sentence boundary after 2.5 seconds", () => {
		const scenes = segmentWords({
			words: [
				{ text: "A", startSec: 0, endSec: 1 },
				{ text: "short", startSec: 1, endSec: 2 },
				{ text: "sentence.", startSec: 2, endSec: 3 },
				{ text: "Next", startSec: 3, endSec: 4 },
			],
		});
		expect(scenes).toHaveLength(2);
		expect(scenes[0]).toMatchObject({
			sceneNumber: 1,
			startTimeSec: 0,
			endTimeSec: 3,
			transcriptText: "A short sentence.",
		});
		expect(scenes[1]?.transcriptText).toBe("Next");
	});

	test("merges short segment-level transcripts", () => {
		const scenes = segmentTranscriptSegments({
			segments: [
				{ text: "One", start: 0, end: 1 },
				{ text: "two.", start: 1, end: 2 },
				{ text: "Three", start: 2, end: 4 },
				{ text: "four.", start: 4, end: 5 },
			],
		});
		expect(scenes.map((scene) => scene.transcriptText)).toEqual([
			"One two. Three four.",
		]);
	});
});

describe("Rhymx planning and scoring", () => {
	test("strictly filters planner ids, duplicates, and oversized fields", () => {
		const plans = parseScenePlan({
			raw: JSON.stringify({
				scenes: [
					{
						id: "scene-1",
						visualIntent: "x".repeat(300),
						keywords: [" launch ", "rocket", "night", "ignored"],
						treatment: "motion",
					},
					{ id: "scene-1", keywords: ["duplicate"] },
					{ id: "unknown", keywords: ["invalid"] },
				],
			}),
			validIds: new Set(["scene-1"]),
		});
		expect(plans).toHaveLength(1);
		expect(plans[0]?.visualIntent).toHaveLength(220);
		expect(plans[0]?.keywords).toEqual(["launch", "rocket", "night"]);
		expect(plans[0]?.treatment).toBe("motion");
	});

	test("rewards relevance and rotates equally-scored providers", () => {
		const pexelsOne = candidate({ id: "p1", provider: "pexels" });
		const pexelsTwo = candidate({ id: "p2", provider: "pexels" });
		const pixabay = candidate({ id: "x1", provider: "pixabay" });
		const context = { queryTerms: ["space", "launch"], targetDurationSec: 5 };
		expect(scoreCandidate({ candidate: pexelsOne, context })).toBeGreaterThan(
			60,
		);
		expect(
			rankCandidates({
				candidates: [pexelsOne, pexelsTwo, pixabay],
				context,
				limit: 3,
			}).map((item) => item.provider),
		).toEqual(["pexels", "pixabay", "pexels"]);
	});
});

describe("Rhymx caption modes", () => {
	const scene: PlanScene = {
		id: "scene-1",
		sceneNumber: 1,
		startTimeSec: 1,
		endTimeSec: 5,
		durationSec: 4,
		transcriptText: "Small extraordinary launch",
		visualIntent: "Rocket launch",
		keywords: ["rocket launch"],
		treatment: "media",
		candidates: [],
		selectedCandidateId: null,
		matchStatus: "idle",
		words: [
			{ id: "w1", text: "Small", startTimeSec: 1, endTimeSec: 2 },
			{
				id: "w2",
				text: "extraordinary",
				startTimeSec: 2,
				endTimeSec: 3.5,
			},
			{ id: "w3", text: "launch", startTimeSec: 3.5, endTimeSec: 5 },
		],
	};

	test("builds phrase, word, and keyword cues from word timing", () => {
		expect(
			buildCaptionCues({ scenes: [scene], mode: "phrase", wordsPerPhrase: 2 }),
		).toHaveLength(2);
		expect(buildCaptionCues({ scenes: [scene], mode: "word" })).toHaveLength(3);
		expect(buildCaptionCues({ scenes: [scene], mode: "keywords" })).toEqual([
			{
				text: "EXTRAORDINARY",
				startTime: 1,
				duration: 4,
			},
		]);
	});
});
