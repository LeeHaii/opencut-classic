import type { PlannedScene } from "../types";
import { isRecord } from "./json";

const MAX_NARRATION_CHARS = 60_000;
const MAX_INTENT_CHARS = 220;
const MAX_KEYWORDS = 3;

export interface ScenePlanRequestScene {
	id: string;
	sceneNumber: number;
	transcriptText: string;
	previousScene: string | null;
	nextScene: string | null;
}

export const SCENE_PLANNER_SYSTEM_PROMPT =
	"You are the visual director for one complete narrated video. " +
	"Understand the full narration, recurring subjects, named entities, setting, tone, and argument before planning individual scenes. " +
	"For every requested scene, return a visualIntent that describes the shot the viewer should see, not a transcript summary. " +
	"Return exactly three distinct English stock-media search phrases. Each phrase must be concrete and visually searchable, using observable subjects, actions, locations, eras, or camera framing. " +
	"Resolve pronouns and abstract language from the full narration. Do not merely extract nearby words, do not repeat the same phrase with tiny changes, and do not invent unsupported people, brands, or events. " +
	'Use treatment "motion" only when designed typography, a statistic, quotation, comparison, title, diagram, transition, or call to action communicates better than footage. Otherwise use "media". ' +
	'Return only JSON: {"scenes":[{"id":"supplied id","visualIntent":"concise shot direction","keywords":["phrase 1","phrase 2","phrase 3"],"treatment":"media or motion"}]}.';

export function buildPlannerUserMessage({
	fullNarration,
	scenesToPlan,
}: {
	fullNarration: string;
	scenesToPlan: ScenePlanRequestScene[];
}): string {
	return JSON.stringify({
		fullNarration: fullNarration.slice(0, MAX_NARRATION_CHARS),
		scenesToPlan,
	});
}

/** Strict parser (ported from Rhymx `parseSceneIntelligence`): caps lengths, coerces treatment. */
export function parseScenePlan({
	raw,
	validIds,
}: {
	raw: string;
	validIds: Set<string>;
}): PlannedScene[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Planner returned invalid JSON");
	}

	const container = isRecord(parsed) ? parsed : null;
	if (!container || !Array.isArray(container.scenes)) {
		throw new Error("Planner response missing scenes array");
	}

	const scenes: PlannedScene[] = [];
	for (const entry of container.scenes) {
		if (!isRecord(entry)) {
			continue;
		}
		const record = entry;
		const id = typeof record.id === "string" ? record.id : null;
		if (!id || !validIds.has(id) || scenes.some((scene) => scene.id === id)) {
			continue;
		}
		const keywordsRaw = Array.isArray(record.keywords) ? record.keywords : [];
		const keywords = keywordsRaw
			.filter((keyword): keyword is string => typeof keyword === "string")
			.map((keyword) => keyword.trim())
			.filter(Boolean)
			.slice(0, MAX_KEYWORDS);
		scenes.push({
			id,
			visualIntent:
				typeof record.visualIntent === "string"
					? record.visualIntent.trim().slice(0, MAX_INTENT_CHARS)
					: "",
			keywords: keywords.length > 0 ? keywords : ["b-roll"],
			treatment: record.treatment === "motion" ? "motion" : "media",
		});
	}

	return scenes;
}
