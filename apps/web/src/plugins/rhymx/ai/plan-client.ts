import {
	buildPlannerUserMessage,
	parseScenePlan,
	SCENE_PLANNER_SYSTEM_PROMPT,
	type ScenePlanRequestScene,
} from "./scene-planner";
import { groqChatJson, GROQ_PLANNER_MODEL } from "./groq-client";
import { isRecord } from "./json";
import type { PlannedScene } from "../types";

/**
 * Plans scenes via the /api/rhymx/plan proxy; falls back to a direct BYOK
 * Groq call when the route is not configured.
 */
export async function planScenes({
	fullNarration,
	requestScenes,
	apiKey,
	signal,
}: {
	fullNarration: string;
	requestScenes: ScenePlanRequestScene[];
	apiKey?: string;
	signal?: AbortSignal;
}): Promise<PlannedScene[]> {
	const userMessage = buildPlannerUserMessage({
		fullNarration,
		scenesToPlan: requestScenes,
	});
	const validIds = new Set(requestScenes.map((scene) => scene.id));

	const runDirect = async (): Promise<string> => {
		if (!apiKey) {
			throw new Error(
				"No planning backend configured. Add a Groq API key in AI panel settings.",
			);
		}
		return groqChatJson({
			apiKey,
			model: GROQ_PLANNER_MODEL,
			systemPrompt: SCENE_PLANNER_SYSTEM_PROMPT,
			userMessage,
			signal,
		});
	};

	let raw: string;
	try {
		const response = await fetch("/api/rhymx/plan", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fullNarration, scenes: requestScenes }),
			signal,
		});
		if (response.ok) {
			const data: unknown = await response.json();
			const payload =
				isRecord(data) && typeof data.raw === "string" ? data.raw : null;
			if (!payload) {
				throw new Error("Server planner returned an unreadable response");
			}
			raw = payload;
		} else if (response.status === 501 || response.status === 404) {
			raw = await runDirect();
		} else {
			throw new Error(`Planning failed (${response.status})`);
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw error;
		}
		if (error instanceof TypeError) {
			raw = await runDirect();
		} else {
			throw error;
		}
	}

	return parseScenePlan({ raw, validIds });
}
