import type { AgentChatMessage } from "./types";
import { buildMotionDesignSkills } from "./design-skills";

export interface PromptContext {
	request: string;
	compositionId: string;
	/** Duration of the clip being authored, in seconds. */
	durationSecs: number;
	width: number;
	height: number;
	fps: number;
	/** Recent conversation turns for continuity (already capped). */
	recentTurns?: AgentChatMessage[];
	/** Absolute paths of reference images copied into the agent workspace. */
	referenceImages?: string[];
	/** An image selected for composition use and frozen by the desktop host. */
	selectedImage?: {
		name: string;
		placeholder: string;
		sourcePageUrl: string;
		attribution: string;
		license: string;
		width: number;
		height: number;
	};
	/** Full source of the selected composition when this turn updates a scene. */
	currentComposition?: string;
}

const MAX_TURNS = 6;
const MAX_REFERENCES = 4;

/**
 * Builds the constrained HyperFrames authoring prompt. Mirrors the proven
 * upstream template but is parameterized by project canvas size/fps instead
 * of hardcoded values.
 */
export function buildAgentPrompt(context: PromptContext): string {
	const {
		request,
		compositionId,
		durationSecs,
		width,
		height,
		fps,
		recentTurns = [],
		referenceImages = [],
		selectedImage,
		currentComposition,
	} = context;

	const history =
		recentTurns.length > 0
			? `\nRecent scene conversation:\n${recentTurns
					.slice(-MAX_TURNS)
					.map((m) => `${m.role.toUpperCase()}: ${m.text}`)
					.join("\n")}\n`
			: "";

	const references =
		referenceImages.length > 0
			? `\nVisual references (MANDATORY FIRST STEP — call view_file on each listed image file before writing any HTML):\n${referenceImages
					.slice(0, MAX_REFERENCES)
					.map((p) => `- ${p}`)
					.join("\n")}\n`
			: "";
	const selectedImageInstructions = selectedImage
		? `\nSelected and frozen image (use it as actual composition media, not only as style inspiration):
- name: ${selectedImage.name}
- exact HTML src: ${selectedImage.placeholder}
${selectedImage.sourcePageUrl ? `- source page: ${selectedImage.sourcePageUrl}\n` : ""}- attribution: ${selectedImage.attribution}
- license: ${selectedImage.license}
- dimensions: ${selectedImage.width}x${selectedImage.height}
Use the exact HTML src above in an <img> element. OpenCut replaces this placeholder with the frozen local file after generation. Never use the remote source URL in HTML.\n`
		: "";
	const currentCompositionInstructions = currentComposition?.trim()
		? `\nExisting composition source (this is the source of truth to edit):
\`\`\`html
${currentComposition}
\`\`\`
Return the COMPLETE updated standalone HTML document, including every unchanged part. A summary, patch, diff, fragment, or claim that a file was edited is not a valid response.\n`
		: "";
	const objective = currentComposition?.trim()
		? "Update the selected existing HyperFrames child composition to fulfil the user's latest request."
		: "Create ONE NEW HyperFrames child composition that fulfils the user's request.";

	return `You are the motion-design agent inside OpenCut. ${objective}

Hard requirements:
- Return a complete standalone HTML document inside one \`\`\`html code fence.
- Keep a single composition root with id="${compositionId}", data-composition-id="${compositionId}", data-start="0", data-duration="${durationSecs}", data-width="${width}", data-height="${height}".
- The child root MUST NOT have data-track-index and its data-start must remain exactly zero; the host timeline controls where the whole child starts.
- Every timed visual uses class="clip", data-start and data-duration in seconds, an integer data-track-index, plus a unique stable id attribute.
- MANDATORY ANIMATION CONTRACT: load GSAP (<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>) and register exactly ONE paused timeline as window.__timelines["${compositionId}"]. Drive ALL motion through tweens added to it. A composition without this registered timeline renders as a frozen frame and is invalid.
- Use literal, stable CSS selector strings in GSAP calls (prefer unique element ids or data-hf-id attributes). Do not build animation targets through variables or string concatenation. Use GSAP percentage keyframes when authoring motion intended for detailed Studio editing; ordinary from/to/fromTo tweens remain supported as two endpoint keys.
- Never animate with CSS transitions, CSS @keyframes, setTimeout, Date.now, Math.random, autoplaying media or wall-clock timing — CSS-only motion cannot be seeked and will appear static in preview and export.
- Every visual element must be revealed or moved by timeline tweens (from/fromTo/to). A fully static composition is a failure. Start each element hidden (opacity 0 or masked) right at its clip's data-start so motion is always visible while playing; give elements that end early an exit tween.
- Do not create a master timeline and do not use data-composition-src. Return only the new self-contained child animation.
- The composition plays at ${fps} fps; keep all timing in whole seconds or clean fractions that align to ${fps} fps frames.
- Keep the exact child duration ${durationSecs} seconds. Do not shorten or extend it.
- Always return the complete resulting HTML document, even when the requested update is small. Never return only an explanation, code fragment, or diff.
- Preserve any existing local media URL exactly unless the user asks to remove it. Local media uses ${"opencut-media://local/..."} URLs — reference them as-is.
- When a selected and frozen image is listed below, inspect the attached reference and use its exact placeholder as the HTML img src. Never substitute another URL.
- Do not use shell commands, network APIs, cookies, localStorage, sessionStorage, the parent window or desktop APIs. CDN script tags are allowed.
- Filesystem access is restricted to view_file on the exact reference files listed below. Never use find_by_name/grep_search/run_command and never search outside the workspace.
- 	Before the html fence, give a concise one-sentence summary of what you made. Do not output a diff.
${references}${selectedImageInstructions}${history}${currentCompositionInstructions}
${buildMotionDesignSkills(durationSecs)}
User request: ${request}`;
}

export interface SeedSpec {
	compositionId: string;
	width: number;
	height: number;
	durationSecs: number;
	fps: number;
}

/**
 * Builds the fresh-composition starting point embedded into each first turn.
 * Mirrors `hyperframes::composition::seed_composition` in rust/crates/hyperframes.
 */
export function buildSeedComposition(spec: SeedSpec): string {
	const fontPx = Math.round(spec.height * 0.07);
	const duration = formatDuration(spec.durationSecs);
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${spec.compositionId}</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: #000; overflow: hidden; }
  #${spec.compositionId} { position: relative; width: ${spec.width}px; height: ${spec.height}px; overflow: hidden; }
</style>
</head>
<body>
<div id="${spec.compositionId}" data-composition-id="${spec.compositionId}" data-start="0" data-duration="${duration}" data-width="${spec.width}" data-height="${spec.height}">
<!--opencut-chat-insert-->
  <h1 class="clip" data-start="0" data-duration="${duration}" data-track-index="0"
      style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font:700 ${fontPx}px sans-serif;">
    New scene
  </h1>
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["${spec.compositionId}"] = (function () {
    const tl = gsap.timeline({ paused: true });
    tl.from("#${spec.compositionId} h1", { opacity: 0, y: 40, duration: 0.8 }, 0);
    return tl;
  })();
</script>
</body>
</html>`;
}

function formatDuration(value: number): string {
	const rounded = Math.round(value * 1000) / 1000;
	return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
