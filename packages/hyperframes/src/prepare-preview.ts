import { previewBridgeSource } from "./bridge-source";

export const PREVIEW_MESSAGE_SOURCE = "opencut-hf-preview";
export const PARENT_MESSAGE_SOURCE = "hf-parent";
export const BRIDGE_SCRIPT_ID = "opencut-preview-bridge";
export const INJECTED_GSAP_MARKER = "data-opencut-gsap";

export interface PrepareOptions {
	/** Inline GSAP source injected instead of CDN scripts (optional). */
	gsapSource?: string
}

const GSAP_CDN_RE = /<script[^>]*src="[^"]*gsap[^"]*"[^>]*>\s*<\/script>\s*/gi;

function escapeClosingTags(source: string): string {
	return source.replace(/<\/script/gi, "<\\/script");
}

/**
 * Produces the sandboxed preview copy of a composition. The stored source
 * HTML is never modified — only this preview copy gets GSAP inlined and the
 * postMessage bridge appended.
 */
export function preparePreviewHtml(html: string, options: PrepareOptions = {}): string {
	let prepared = html;

	if (options.gsapSource) {
		prepared = prepared.replace(
			GSAP_CDN_RE,
			`<script ${INJECTED_GSAP_MARKER}>${escapeClosingTags(options.gsapSource)}</script>`,
		);
	}

	const bridge = `<script id="${BRIDGE_SCRIPT_ID}">${escapeClosingTags(previewBridgeSource)}</script>`;
	if (prepared.includes("</body>")) {
		prepared = prepared.replace("</body>", `${bridge}</body>`);
	} else {
		prepared += bridge;
	}
	return prepared;
}
