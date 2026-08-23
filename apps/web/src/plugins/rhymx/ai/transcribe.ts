import {
	groqTranscribeAudio,
	extractErrorMessage,
	parseTranscriptionPayload,
	type GroqTranscriptionResult,
} from "./groq-client";

export interface RhymxTranscriptionResult extends GroqTranscriptionResult {
	source: "server" | "byok";
}

/**
 * Transcribes a voiceover file. Prefers the server proxy (env key); falls
 * back to a direct BYOK call when the route is not configured.
 */
export async function transcribeVoiceover({
	file,
	apiKey,
	signal,
}: {
	file: File;
	apiKey?: string;
	signal?: AbortSignal;
}): Promise<RhymxTranscriptionResult> {
	try {
		const form = new FormData();
		form.append("file", file, file.name || "voiceover.wav");
		const response = await fetch("/api/rhymx/transcribe", {
			method: "POST",
			body: form,
			signal,
		});
		if (response.ok) {
			const data: unknown = await response.json();
			const parsed = parseTranscriptionPayload(data);
			if (!parsed) {
				throw new Error("Server transcription was unreadable");
			}
			return { ...parsed, source: "server" };
		}
		if (response.status !== 501 && response.status !== 404) {
			const message = await safeErrorMessage(response);
			throw new Error(message);
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw error;
		}
		if (!(error instanceof TypeError)) {
			throw error;
		}
	}

	if (!apiKey) {
		throw new Error(
			"No transcription backend configured. Add a Groq API key in AI panel settings.",
		);
	}
	const result = await groqTranscribeAudio({ apiKey, file, signal });
	return { ...result, source: "byok" };
}

async function safeErrorMessage(response: Response): Promise<string> {
	try {
		const data: unknown = await response.json();
		return (
			extractErrorMessage(data) ?? `Transcription failed (${response.status})`
		);
	} catch {
		return `Transcription failed (${response.status})`;
	}
}
