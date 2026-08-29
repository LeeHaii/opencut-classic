export const MAX_HTML_CHARS = 1_000_000;

export interface CompositionInfo {
	compositionId: string
	durationSecs: number
	width: number
	height: number
	isMaster: boolean
	childCount: number
}

/**
 * Extracts the composition HTML document from an agent reply. Prefers a
 * ```html fenced block containing data-composition-id, then any doctype
 * document containing it.
 */
export function extractHtml(text: string): string | null {
	const direct = extractHtmlDocument(text);
	if (direct) return direct;

	if (text.includes("data-composition-id") && /&lt;/i.test(text)) {
		return extractHtmlDocument(decodeEscapedMarkup(text));
	}
	return null;
}

function extractHtmlDocument(text: string): string | null {
	const fenceRe = /```(?:html[ \t]*)?\r?\n([\s\S]*?)\r?\n?```/gi;
	for (const match of text.matchAll(fenceRe)) {
		const body = match[1]?.trim();
		if (body?.includes("data-composition-id") && /<html\b/i.test(body)) {
			return body;
		}
	}
	const doctypeIndex = text.search(/<!doctype\s+html\b/i);
	const htmlIndex = text.search(/<html\b/i);
	const start = doctypeIndex >= 0 ? doctypeIndex : htmlIndex;
	if (start >= 0) {
		const end = text.toLowerCase().lastIndexOf("</html>");
		if (end > start) {
			const doc = text.slice(start, end + "</html>".length);
			if (doc.includes("data-composition-id")) {
				return doc;
			}
		}
	}
	return null;
}

function decodeEscapedMarkup(text: string): string {
	return text
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#(?:39|x27);/gi, "'")
		.replace(/&amp;/gi, "&");
}

function readAttribute(tag: string, name: string): string | null {
	const re = new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i");
	const match = tag.match(re);
	return match?.[1] ?? null;
}

/** Client-side mirror of `hyperframes::composition::validate_composition`. */
export function quickValidate(html: string): CompositionInfo | null {
	if (html.length > MAX_HTML_CHARS || !html.includes("data-composition-id")) {
		return null;
	}
	const tagMatch = html.match(/<[a-zA-Z][^<>]*data-composition-id[^<>]*>/);
	if (!tagMatch) {
		return null;
	}
	const tag = tagMatch[0];
	const compositionId = readAttribute(tag, "data-composition-id") ?? "";
	if (!compositionId) {
		return null;
	}
	const durationRaw = Number.parseFloat(readAttribute(tag, "data-duration") ?? "");
	const durationSecs =
		Number.isFinite(durationRaw) && durationRaw > 0 ? Math.min(Math.max(durationRaw, 0.1), 3600) : 5;
	const width = Number.parseInt(readAttribute(tag, "data-width") ?? "", 10) || 1920;
	const height = Number.parseInt(readAttribute(tag, "data-height") ?? "", 10) || 1080;
	const isMaster = tag.includes("data-opencut-master");
	const childCount = (html.match(/data-composition-src/g) ?? []).length;
	return { compositionId, durationSecs, width, height, isMaster, childCount };
}

export interface AnimationAudit {
	/** A window.__timelines registration is present. */
	hasTimeline: boolean
	/** The timeline actually contains GSAP tweens (from/to/fromTo/set/add). */
	hasTweens: boolean
}

/**
 * Heuristically verifies that a composition wires its motion into a seekable
 * window.__timelines GSAP timeline. Compositions that fail this audit render
 * as frozen frames in preview/export because the bridge can only seek a
 * registered timeline.
 */
export function auditCompositionAnimation(html: string): AnimationAudit {
	const hasTimeline =
		/__timelines\s*(?:\[\s*["'`][^"'`]*["'`]\s*\]\s*=|=\s*\{)/.test(html) ||
		/Object\.assign\(\s*window\.__timelines/.test(html);
	if (!hasTimeline) {
		return { hasTimeline: false, hasTweens: false };
	}
	const usesGsap = /\bgsap\b/.test(html);
	const hasTweens =
		usesGsap &&
		/\.\s*(?:from|fromTo|to|set|add)\s*\(/.test(html);
	return { hasTimeline, hasTweens };
}
