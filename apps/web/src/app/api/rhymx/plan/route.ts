import { NextResponse } from "next/server";
import { z } from "zod";
import { extractChatContent, extractErrorMessage } from "@/plugins/rhymx/ai/groq-client";

const requestSchema = z.object({
	fullNarration: z.string().max(80_000),
	scenes: z
		.array(
			z.object({
				id: z.string().min(1).max(64),
				sceneNumber: z.number().int().positive(),
				transcriptText: z.string().max(4_000),
				previousScene: z.string().max(4_000).nullable(),
				nextScene: z.string().max(4_000).nullable(),
			}),
		)
		.min(1)
		.max(200),
});

const SYSTEM_PROMPT =
	"You are the visual director for one complete narrated video. " +
	"Understand the full narration, recurring subjects, named entities, setting, tone, and argument before planning individual scenes. " +
	"For every requested scene, return a visualIntent that describes the shot the viewer should see, not a transcript summary. " +
	"Return exactly three distinct English stock-media search phrases. Each phrase must be concrete and visually searchable, using observable subjects, actions, locations, eras, or camera framing. " +
	"Resolve pronouns and abstract language from the full narration. Do not merely extract nearby words, do not repeat the same phrase with tiny changes, and do not invent unsupported people, brands, or events. " +
	'Use treatment "motion" only when designed typography, a statistic, quotation, comparison, title, diagram, transition, or call to action communicates better than footage. Otherwise use "media". ' +
	'Return only JSON: {"scenes":[{"id":"supplied id","visualIntent":"concise shot direction","keywords":["phrase 1","phrase 2","phrase 3"],"treatment":"media or motion"}]}.';

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const PLANNER_MODEL = "llama-3.1-8b-instant";

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
			{ error: "Server planner not configured" },
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
		return NextResponse.json(
			{ error: "Invalid parameters", details: parsed.error.flatten() },
			{ status: 400 },
		);
	}

	try {
		const response = await fetch(GROQ_CHAT_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: PLANNER_MODEL,
				temperature: 0.15,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{
						role: "user",
						content: JSON.stringify({
							fullNarration: parsed.data.fullNarration,
							scenesToPlan: parsed.data.scenes,
						}),
					},
				],
			}),
		});
		const data: unknown = await response.json();
		const content = extractChatContent(data);
		const errorMessage = extractErrorMessage(data);

		if (!response.ok || !content) {
			return NextResponse.json(
				{
					error:
						errorMessage ?? `Upstream planning failed (${response.status})`,
				},
				{ status: 502 },
			);
		}
		return NextResponse.json({ raw: content });
	} catch (error) {
		console.error("[rhymx] plan error:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
