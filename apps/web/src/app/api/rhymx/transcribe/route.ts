import { NextResponse } from "next/server";
import { isRecord } from "@/plugins/rhymx/ai/json";

const GROQ_TRANSCRIBE_URL =
	"https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-large-v3-turbo";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
	const apiKey = process.env.GROQ_API_KEY;
	if (!apiKey) {
		return NextResponse.json(
			{ error: "Server transcription not configured" },
			{ status: 501 },
		);
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return NextResponse.json(
			{ error: "Expected multipart form data" },
			{ status: 400 },
		);
	}

	const file = form.get("file");
	if (!(file instanceof File)) {
		return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		return NextResponse.json(
			{ error: "Audio exceeds the 25 MB server limit; use a BYOK key instead" },
			{ status: 413 },
		);
	}

	const upstream = new FormData();
	upstream.append("file", file, file.name || "voiceover.wav");
	upstream.append("model", WHISPER_MODEL);
	upstream.append("response_format", "verbose_json");
	const language = form.get("language");
	if (typeof language === "string" && /^[a-zA-Z]{2,8}$/.test(language)) {
		upstream.append("language", language);
	}
	upstream.append("timestamp_granularities[]", "word");
	upstream.append("timestamp_granularities[]", "segment");

	try {
		const response = await fetch(GROQ_TRANSCRIBE_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: upstream,
		});
		const data: unknown = await response.json();
		if (!response.ok) {
			const record = isRecord(data) ? data.error : undefined;
			const message = isRecord(record) ? record.message : undefined;
			return NextResponse.json(
				{
					error:
						(typeof message === "string" ? message : null) ??
						`Upstream transcription failed (${response.status})`,
				},
				{ status: 502 },
			);
		}
		return NextResponse.json(data);
	} catch (error) {
		console.error("[rhymx] transcribe error:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
