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
	const fenceRe = /```(?:html|HTML)\s*\n([\s\S]*?)\n?```/g;
	for (const match of text.matchAll(fenceRe)) {
		const body = match[1];
		if (body?.includes("data-composition-id")) {
			return body;
		}
	}
	const doctypeIndex = text.search(/<!DOCTYPE html|<!doctype html/);
	if (doctypeIndex >= 0) {
		const end = text.lastIndexOf("</html>");
		if (end > doctypeIndex) {
			const doc = text.slice(doctypeIndex, end + "</html>".length);
			if (doc.includes("data-composition-id")) {
				return doc;
			}
		}
	}
	return null;
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
