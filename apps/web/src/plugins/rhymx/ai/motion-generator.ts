import {
	auditCompositionAnimation,
	buildAgentPrompt,
	buildSeedComposition,
	deriveStyleDirection,
	extractHtml,
	quickValidate,
	isNative,
	nativeInvoke,
	onAntigravityDone,
	onAntigravityError,
} from "@opencut/hyperframes";
import { runBrowserHyperframesAgent } from "@/hyperframes/browser-agent";

export interface MotionSceneInput {
	sceneNumber: number;
	visualIntent: string;
	keywords: string[];
	transcriptText: string;
	durationSec: number;
}

export interface MotionGenerationContext {
	projectId: string;
	width: number;
	height: number;
	fps: number;
	apiKey?: string;
	signal?: AbortSignal;
}

export interface MotionGenerationResult {
	html: string;
	compositionId: string;
	durationSecs: number;
}

/**
 * Generates one HyperFrames motion-graphics scene for a planned scene via
 * the same agent transport the AI Motion panel uses (Antigravity on
 * desktop, Groq in the browser).
 */
export async function generateMotionSceneHtml({
	scene,
	context,
}: {
	scene: MotionSceneInput;
	context: MotionGenerationContext;
}): Promise<MotionGenerationResult> {
	const compositionId = `rhymx-scene-${scene.sceneNumber}-${randomSuffix()}`;
	const { width, height, fps } = context;
	const durationSec = scene.durationSec;
	const request = buildMotionRequestText({ scene });

	const prompt = `${buildAgentPrompt({
		request,
		compositionId,
		durationSecs: durationSec,
		width,
		height,
		fps,
	})}\nFresh child-composition starting point:\n\`\`\`html\n${buildSeedComposition(
		{ compositionId, width, height, durationSecs: durationSec, fps },
	)}\n\`\`\`\n`;

	const text = isNative()
		? await runNativeAgent({
				prompt,
				projectId: context.projectId,
				signal: context.signal,
			})
		: await runBrowserHyperframesAgent({
				prompt,
				apiKey: context.apiKey,
				signal: context.signal,
			});

	const html = extractHtml(text);
	const info = html ? quickValidate(html) : null;
	if (!html || !info) {
		throw new Error(
			"The AI did not return a valid motion scene. Try again or fall back to a template.",
		);
	}
	const animation = auditCompositionAnimation(html);
	if (!animation.hasTweens) {
		throw new Error(
			"The AI returned a static composition with no seekable animation timeline — it would render as a frozen frame. Retrying usually fixes it; otherwise this scene falls back to its template.",
		);
	}
	return { html, compositionId, durationSecs: info.durationSecs };
}

function buildMotionRequestText({
	scene,
}: {
	scene: MotionSceneInput;
}): string {
	const keywords = scene.keywords.filter(Boolean).slice(0, 8);
	const direction = deriveStyleDirection(
		[scene.visualIntent, ...keywords, scene.transcriptText].join(" "),
	);
	return `Create a motion-graphics scene for a narrated video.
Visual direction: ${scene.visualIntent || "a clean, engaging title scene"}.
Key ideas to emphasize on screen: ${keywords.length > 0 ? keywords.join(", ") : "the core message of the narration"}.
Narration playing over this scene: "${scene.transcriptText.slice(0, 300)}".
Art direction — commit fully to this system and carry it through every element:
Style direction: ${direction.name} (${direction.mood}).
Palette: ${direction.palette}.
Typography: ${direction.typography}.
Motion character: ${direction.motion}.
Additional guidance: strong readable hierarchy, generous safe margins, one accent color reserved for emphasis, staggered entrances with overlapping flow so motion never stops dead. Text content should come from the key ideas and narration — keep on-screen text short and punchy. Do not use external images or videos; inline SVG shapes and unicode symbols are fine.`;
}

async function runNativeAgent({
	prompt,
	projectId,
	signal,
}: {
	prompt: string;
	projectId: string;
	signal?: AbortSignal;
}): Promise<string> {
	const requestId = `rhymx-motion-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;

	return new Promise<string>((resolve, reject) => {
		let settled = false;
		let cleanup = () => {};
		const settle = (settleFn: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			settleFn();
		};

		if (signal) {
			if (signal.aborted) {
				settle(() => reject(abortError()));
				return;
			}
			signal.addEventListener(
				"abort",
				() => {
					void nativeInvoke("antigravity_cancel", { requestId }).catch(
						() => {},
					);
					settle(() => reject(abortError()));
				},
				{ once: true },
			);
		}

		void (async () => {
			const offDone = await onAntigravityDone((payload) => {
				if (payload.requestId !== requestId) return;
				settle(() => {
					if (payload.error) {
						reject(new Error(payload.error));
					} else {
						resolve(payload.text);
					}
				});
			});
			const offError = await onAntigravityError((payload) => {
				if (payload.requestId !== requestId) return;
				settle(() => reject(new Error(payload.message)));
			});
			cleanup = () => {
				offDone();
				offError();
			};
			if (settled) cleanup();

			try {
				await nativeInvoke("antigravity_run", {
					request: { requestId, projectId, prompt },
				});
			} catch (error) {
				settle(() =>
					reject(error instanceof Error ? error : new Error(String(error))),
				);
			}
		})();
	});
}

function abortError(): Error {
	return new DOMException("Motion generation cancelled", "AbortError");
}

function randomSuffix(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
		: Math.random().toString(36).slice(2, 12);
}
