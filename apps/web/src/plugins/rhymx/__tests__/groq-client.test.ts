import { expect, test } from "bun:test";
import { extractJsonPayload, groqChatJson } from "../ai/groq-client";

test("extractJsonPayload pulls JSON out of fenced or prose-wrapped output", () => {
	expect(extractJsonPayload('{"a":1}')).toBe('{"a":1}');
	expect(extractJsonPayload('```json\n{"a":1}\n```')).toBe('{"a":1}');
	expect(
		extractJsonPayload('Sure! Here is the plan:\n{"scenes":[{"id":"s1"}]} done'),
	).toBe('{"scenes":[{"id":"s1"}]}');
	expect(
		extractJsonPayload('text {"nested":{"quote":"brace } inside"}} tail'),
	).toBe('{"nested":{"quote":"brace } inside"}}');
	expect(extractJsonPayload("no json here")).toBeNull();
	expect(extractJsonPayload('{"unterminated": [1,2}')).toBeNull();
});

const GROQ_JSON_VALIDATE_ERROR = {
	error: {
		message:
			"Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
		code: "json_validate_failed",
		failed_generation: "",
	},
};

function withMockFetch(
	handler: (...args: Parameters<typeof fetch>) => Promise<Response>,
) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = Object.assign(handler, {
		preconnect: originalFetch.preconnect,
	});
	return () => {
		globalThis.fetch = originalFetch;
	};
}

test("groqChatJson salvages valid JSON from failed_generation without retrying", async () => {
	const requests: Array<Record<string, unknown>> = [];
	const restore = withMockFetch(async (_input, init) => {
		requests.push(JSON.parse(String(init?.body)));
		return Response.json(
			{
				...GROQ_JSON_VALIDATE_ERROR,
				error: {
					...GROQ_JSON_VALIDATE_ERROR.error,
					failed_generation:
						'Here you go:\n```json\n{"scenes":[{"id":"s1"}]}\n```',
				},
			},
			{ status: 400 },
		);
	});
	try {
		await expect(
			groqChatJson({
				apiKey: "test-key",
				systemPrompt: "system",
				userMessage: "user",
			}),
		).resolves.toBe('{"scenes":[{"id":"s1"}]}');
		expect(requests).toHaveLength(1);
	} finally {
		restore();
	}
});

test("groqChatJson retries without JSON mode when generation is unsalvageable", async () => {
	let call = 0;
	const jsonModes: boolean[] = [];
	const restore = withMockFetch(async (_input, init) => {
		call += 1;
		const body: unknown = JSON.parse(String(init?.body));
		jsonModes.push(
			typeof body === "object" && body !== null && "response_format" in body,
		);
		if (call === 1) {
			return Response.json(GROQ_JSON_VALIDATE_ERROR, { status: 400 });
		}
		return Response.json({
			choices: [
				{ message: { content: 'The plan is:\n{"scenes":[{"id":"s1"}]}' } },
			],
		});
	});
	try {
		await expect(
			groqChatJson({
				apiKey: "test-key",
				systemPrompt: "system",
				userMessage: "user",
			}),
		).resolves.toBe('{"scenes":[{"id":"s1"}]}');
		expect(jsonModes).toEqual([true, false]);
	} finally {
		restore();
	}
});

test("groqChatJson surfaces a friendly error when both attempts fail", async () => {
	let call = 0;
	const restore = withMockFetch(async () => {
		call += 1;
		if (call === 1) {
			return Response.json(GROQ_JSON_VALIDATE_ERROR, { status: 400 });
		}
		return Response.json({
			choices: [{ message: { content: "I cannot do that." } }],
		});
	});
	try {
		await expect(
			groqChatJson({
				apiKey: "test-key",
				systemPrompt: "system",
				userMessage: "user",
			}),
		).rejects.toThrow("malformed JSON twice");
	} finally {
		restore();
	}
});

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
