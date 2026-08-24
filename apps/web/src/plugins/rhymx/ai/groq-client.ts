import { isRecord, recordArray } from "./json";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GROQ_TRANSCRIBE_URL =
	"https://api.groq.com/openai/v1/audio/transcriptions";

export const GROQ_PLANNER_MODEL = "openai/gpt-oss-120b";
export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

const CHAT_MODEL_PREFERENCES = [
	GROQ_PLANNER_MODEL,
	"openai/gpt-oss-20b",
	"qwen/qwen3.6-27b",
] as const;

interface GroqChatOptions {
	apiKey: string;
	model?: string;
	systemPrompt: string;
	userMessage: string;
	temperature?: number;
	signal?: AbortSignal;
}

function parseGroqModelIds(data: unknown): string[] {
	if (!isRecord(data) || !Array.isArray(data.data)) return [];
	return data.data.flatMap((entry) =>
		isRecord(entry) && typeof entry.id === "string" ? [entry.id] : [],
	);
}

async function discoverGroqChatModel({
	apiKey,
	exclude,
	signal,
}: {
	apiKey: string;
	exclude?: string;
	signal?: AbortSignal;
}): Promise<string | null> {
	const response = await fetch(GROQ_MODELS_URL, {
		headers: { Authorization: `Bearer ${apiKey}` },
		signal,
	});
	if (!response.ok) return null;
	const available = new Set(parseGroqModelIds(await response.json()));
	for (const preferred of CHAT_MODEL_PREFERENCES) {
		if (preferred !== exclude && available.has(preferred)) return preferred;
	}
	return (
		Array.from(available).find(
			(id) =>
				id !== exclude &&
				!id.toLowerCase().includes("whisper") &&
				!id.toLowerCase().includes("guard"),
		) ?? null
	);
}

function isUnavailableModelError({
	status,
	message,
}: {
	status: number;
	message: string | null;
}): boolean {
	return (
		status === 404 ||
		(status === 400 && Boolean(message?.toLowerCase().includes("model")))
	);
}

/** Safely pulls `choices[0].message.content` out of an unknown payload. */
export function extractChatContent(data: unknown): string | null {
	if (!isRecord(data) || !Array.isArray(data.choices)) {
		return null;
	}
	const first = data.choices[0];
	const message = isRecord(first) ? first.message : undefined;
	const content = isRecord(message) ? message.content : undefined;
	return typeof content === "string" && content.length > 0 ? content : null;
}

/** Safely pulls an error message out of an unknown API payload. */
export function extractErrorMessage(data: unknown): string | null {
	const error = isRecord(data) ? data.error : undefined;
	const message = isRecord(error) ? error.message : undefined;
	return typeof message === "string" && message.length > 0 ? message : null;
}

/** JSON-mode chat completion against Groq. */
async function groqChat({
	apiKey,
	model,
	systemPrompt,
	userMessage,
	temperature,
	signal,
	jsonMode,
	allowModelFallback = true,
}: GroqChatOptions & {
	model: string;
	temperature: number;
	jsonMode: boolean;
	allowModelFallback?: boolean;
}): Promise<string> {
	const response = await fetch(GROQ_CHAT_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			temperature,
			...(jsonMode ? { response_format: { type: "json_object" } } : {}),
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
		}),
		signal,
	});

	const data: unknown = await response.json();
	if (!response.ok) {
		const message = extractErrorMessage(data);
		if (
			allowModelFallback &&
			isUnavailableModelError({ status: response.status, message })
		) {
			const fallback = await discoverGroqChatModel({
				apiKey,
				exclude: model,
				signal,
			});
			if (fallback) {
				return groqChat({
					apiKey,
					model: fallback,
					systemPrompt,
					userMessage,
					temperature,
					signal,
					jsonMode,
					allowModelFallback: false,
				});
			}
		}
		throw new Error(message ?? `Groq request failed (${response.status})`);
	}
	const content = extractChatContent(data);
	if (!content) {
		throw new Error("Groq returned an empty completion");
	}
	return content;
}

/** JSON-mode chat completion against Groq with model discovery fallback. */
export async function groqChatJson({
	apiKey,
	model = GROQ_PLANNER_MODEL,
	systemPrompt,
	userMessage,
	temperature = 0.15,
	signal,
}: GroqChatOptions): Promise<string> {
	return groqChat({
		apiKey,
		model,
		systemPrompt,
		userMessage,
		temperature,
		signal,
		jsonMode: true,
	});
}

/** Text chat completion used by browser-native HyperFrames generation. */
export async function groqChatText({
	apiKey,
	model = GROQ_PLANNER_MODEL,
	systemPrompt,
	userMessage,
	temperature = 0.2,
	signal,
}: GroqChatOptions): Promise<string> {
	return groqChat({
		apiKey,
		model,
		systemPrompt,
		userMessage,
		temperature,
		signal,
		jsonMode: false,
	});
}

export interface GroqTranscriptionWord {
	word: string;
	start: number;
	end: number;
}

export interface GroqTranscriptionSegment {
	text: string;
	start: number;
	end: number;
}

export interface GroqTranscriptionResult {
	text: string;
	segments: GroqTranscriptionSegment[];
	words: GroqTranscriptionWord[];
	language: string;
}

/** Safely parses a verbose_json transcription payload. */
export function parseTranscriptionPayload(
	data: unknown,
): GroqTranscriptionResult | null {
	if (!isRecord(data)) {
		return null;
	}
	const text = typeof data.text === "string" ? data.text : "";
	return {
		text,
		language: typeof data.language === "string" ? data.language : "unknown",
		segments: recordArray(data.segments).flatMap((item) => {
			if (
				typeof item.text !== "string" ||
				typeof item.start !== "number" ||
				typeof item.end !== "number"
			) {
				return [];
			}
			return [{ text: item.text, start: item.start, end: item.end }];
		}),
		words: recordArray(data.words).flatMap((item) => {
			if (
				typeof item.word !== "string" ||
				typeof item.start !== "number" ||
				typeof item.end !== "number"
			) {
				return [];
			}
			return [{ word: item.word, start: item.start, end: item.end }];
		}),
	};
}

/** Whisper transcription with word-level timestamps. */
export async function groqTranscribeAudio({
	apiKey,
	file,
	model = GROQ_WHISPER_MODEL,
	signal,
}: {
	apiKey: string;
	file: File;
	model?: string;
	signal?: AbortSignal;
}): Promise<GroqTranscriptionResult> {
	const form = new FormData();
	form.append("file", file, file.name || "voiceover.wav");
	form.append("model", model);
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "word");
	form.append("timestamp_granularities[]", "segment");

	const response = await fetch(GROQ_TRANSCRIBE_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: form,
		signal,
	});

	const data: unknown = await response.json();
	if (!response.ok) {
		throw new Error(
			extractErrorMessage(data) ??
				`Groq transcription failed (${response.status})`,
		);
	}
	const parsed = parseTranscriptionPayload(data);
	if (!parsed) {
		throw new Error("Groq returned an unreadable transcription");
	}
	return parsed;
}
