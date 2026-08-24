import { NextResponse } from "next/server";
import { z } from "zod";
import {
	groqChatText,
	GROQ_PLANNER_MODEL,
} from "@/plugins/rhymx/ai/groq-client";

const requestSchema = z.object({
	prompt: z.string().min(1).max(120_000),
	model: z.string().min(1).max(120).optional(),
});

const rateBuckets = new Map<string, number[]>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function isRateLimited({ ip }: { ip: string }): boolean {
	const now = Date.now();
	const hits = (rateBuckets.get(ip) ?? []).filter(
		(time) => now - time < RATE_WINDOW_MS,
	);
	if (hits.length >= RATE_LIMIT) {
		rateBuckets.set(ip, hits);
		return true;
	}
	hits.push(now);
	rateBuckets.set(ip, hits);
	return false;
}

export async function POST(request: Request) {
	const apiKey = process.env.GROQ_API_KEY;
	if (!apiKey) {
		return NextResponse.json(
			{ error: "Server HyperFrames agent is not configured" },
			{ status: 501 },
		);
	}
	const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
	if (isRateLimited({ ip })) {
		return NextResponse.json({ error: "Too many requests" }, { status: 429 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const parsed = requestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
	}

	try {
		const text = await groqChatText({
			apiKey,
			model:
				parsed.data.model ??
				process.env.GROQ_HYPERFRAMES_MODEL ??
				GROQ_PLANNER_MODEL,
			systemPrompt:
				"You author deterministic, seekable HyperFrames HTML. Follow every output and security constraint in the user prompt exactly.",
			userMessage: parsed.data.prompt,
			temperature: 0.2,
		});
		return NextResponse.json({ text });
	} catch (error) {
		console.error("[hyperframes] browser agent error:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Generation failed" },
			{ status: 502 },
		);
	}
}
