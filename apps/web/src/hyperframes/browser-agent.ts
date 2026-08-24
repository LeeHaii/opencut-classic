import {
	groqChatText,
	GROQ_PLANNER_MODEL,
} from "@/plugins/rhymx/ai/groq-client";
import { isRecord } from "@/plugins/rhymx/ai/json";

const SYSTEM_PROMPT =
	"You author deterministic, seekable HyperFrames HTML. Follow every output and security constraint in the user prompt exactly.";

function responseError({
	data,
	fallback,
}: {
	data: unknown;
	fallback: string;
}): string {
	return isRecord(data) && typeof data.error === "string"
		? data.error
		: fallback;
}

export async function runBrowserHyperframesAgent({
	prompt,
	apiKey,
	model,
	images,
	signal,
}: {
	prompt: string;
	apiKey?: string;
	model?: string;
	/** Reference images as data URLs. */
	images?: string[];
	signal?: AbortSignal;
}): Promise<string> {
	try {
		const response = await fetch("/api/hyperframes/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				prompt,
				...(images && images.length > 0 ? { images } : {}),
				...(model ? { model } : {}),
			}),
			signal,
		});
		const data: unknown = await response.json();
		if (response.ok && isRecord(data) && typeof data.text === "string") {
			return data.text;
		}
		if (response.status !== 501 && response.status !== 404) {
			throw new Error(
				responseError({
					data,
					fallback: `HyperFrames generation failed (${response.status})`,
				}),
			);
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError")
			throw error;
		if (!(error instanceof TypeError)) throw error;
	}

	if (!apiKey) {
		throw new Error(
			"No browser AI backend is configured. Set GROQ_API_KEY on the server or add a Groq key in the Rhymx AI settings.",
		);
	}
	return groqChatText({
		apiKey,
		model: model || GROQ_PLANNER_MODEL,
		systemPrompt: SYSTEM_PROMPT,
		userMessage: prompt,
		images,
		temperature: 0.2,
		signal,
	});
}
