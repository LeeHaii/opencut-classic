import { expect, test } from "bun:test";
import { groqChatJson } from "../ai/groq-client";

test("Groq chat discovers an available model when the configured model is gone", async () => {
	const originalFetch = globalThis.fetch;
	const requestedModels: string[] = [];
	const mockFetch = async (
		...args: Parameters<typeof fetch>
	): Promise<Response> => {
		const [input, init] = args;
		const url = String(input);
		if (url.endsWith("/models")) {
			return Response.json({ data: [{ id: "openai/gpt-oss-20b" }] });
		}
		const body: unknown = JSON.parse(String(init?.body));
		const model =
			typeof body === "object" &&
			body !== null &&
			"model" in body &&
			typeof body.model === "string"
				? body.model
				: "";
		requestedModels.push(model);
		if (model === "removed-model") {
			return Response.json(
				{ error: { message: "The model does not exist" } },
				{ status: 400 },
			);
		}
		return Response.json({
			choices: [{ message: { content: '{"ok":true}' } }],
		});
	};
	globalThis.fetch = Object.assign(mockFetch, {
		preconnect: originalFetch.preconnect,
	});
	try {
		await expect(
			groqChatJson({
				apiKey: "test-key",
				model: "removed-model",
				systemPrompt: "system",
				userMessage: "user",
			}),
		).resolves.toBe('{"ok":true}');
		expect(requestedModels).toEqual(["removed-model", "openai/gpt-oss-20b"]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
