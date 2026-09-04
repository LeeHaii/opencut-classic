import { quickValidate } from "@opencut/hyperframes";

export type StudioTool = "select" | "interact";
export type StudioWorkspaceView = "layers" | "source";

export interface StudioLayer {
	key: string;
	id: string | null;
	hfId: string | null;
	selector: string;
	label: string;
	tag: string;
	text: string;
	start: number;
	duration: number;
	track: number;
	playbackStart: number | null;
	playbackStartAttribute: "media-start" | "playback-start" | null;
	hidden: boolean;
	styles: Record<string, string>;
}

export interface StudioDocument {
	compositionId: string;
	duration: number;
	width: number;
	height: number;
	layers: StudioLayer[];
}

export interface StudioPreviewSelection {
	key: string;
	id: string | null;
	hfId: string | null;
	selector: string;
	label: string;
	tagName: string;
	textContent: string;
	dataAttributes: Record<string, string>;
	computedStyles: Record<string, string>;
	boundingBox: { x: number; y: number; width: number; height: number };
}

export function studioLayerFromPreviewSelection({
	selection,
	duration,
}: {
	selection: StudioPreviewSelection;
	duration: number;
}): StudioLayer {
	return {
		key: selection.key,
		id: selection.id,
		hfId: selection.hfId,
		selector: selection.selector,
		label: selection.label,
		tag: selection.tagName,
		text: selection.textContent,
		start: Number(selection.dataAttributes.start) || 0,
		duration: Number(selection.dataAttributes.duration) || duration,
		track: Number(selection.dataAttributes["track-index"]) || 0,
		playbackStart:
			Number(
				selection.dataAttributes["media-start"] ??
					selection.dataAttributes["playback-start"],
			) || null,
		playbackStartAttribute: selection.dataAttributes["media-start"]
			? "media-start"
			: selection.dataAttributes["playback-start"]
				? "playback-start"
				: null,
		hidden:
			selection.dataAttributes.hidden === "true" ||
			selection.dataAttributes.hidden === "1",
		styles: {},
	};
}

export type StudioPatchOperation =
	| { type: "inline-style"; property: string; value: string | null }
	| { type: "attribute"; property: string; value: string | null }
	| { type: "html-attribute"; property: string; value: string | null }
	| { type: "text-content"; property: "textContent"; value: string };

let cachedDocumentHtml = "";
let cachedDocument: StudioDocument | null = null;

function finiteNumber({
	value,
	fallback = 0,
}: {
	value: string | null;
	fallback?: number;
}): number {
	const parsed = Number.parseFloat(value ?? "");
	return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInlineStyles(value: string | null): Record<string, string> {
	const styles: Record<string, string> = {};
	for (const declaration of (value ?? "").split(";")) {
		const colon = declaration.indexOf(":");
		if (colon < 0) continue;
		const property = declaration.slice(0, colon).trim();
		const propertyValue = declaration.slice(colon + 1).trim();
		if (property && propertyValue) styles[property] = propertyValue;
	}
	return styles;
}

function escapeSelectorValue(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute({
	value,
	quote,
}: {
	value: string;
	quote: string;
}): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(quote === '"' ? /"/g : /'/g, quote === '"' ? "&quot;" : "&#39;");
}

interface SourceTagMatch {
	tag: string;
	tagName: string;
	start: number;
	end: number;
}

function findSourceTagByAttribute({
	html,
	attribute,
	value,
}: {
	html: string;
	attribute: "id" | "data-hf-id";
	value: string;
}): SourceTagMatch | null {
	const pattern = new RegExp(
		`<([a-zA-Z][a-zA-Z0-9:-]*)\\b[^>]*\\b${escapeRegExp(attribute)}\\s*=\\s*(["'])${escapeRegExp(value)}\\2[^>]*>`,
		"i",
	);
	const match = pattern.exec(html);
	if (!match || match.index == null) return null;
	return {
		tag: match[0],
		tagName: match[1],
		start: match.index,
		end: match.index + match[0].length,
	};
}

function replaceSourceTag({
	html,
	match,
	tag,
}: {
	html: string;
	match: SourceTagMatch;
	tag: string;
}): string {
	return `${html.slice(0, match.start)}${tag}${html.slice(match.end)}`;
}

function patchSourceTag({
	html,
	match,
	operation,
}: {
	html: string;
	match: SourceTagMatch;
	operation: Exclude<StudioPatchOperation, { type: "text-content" }>;
}): string {
	const tag = match.tag;
	if (operation.type === "inline-style") {
		const styleMatch = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
		const styles = new Map(
			Object.entries(parseInlineStyles(styleMatch?.[2] ?? "")),
		);
		if (operation.value === null) styles.delete(operation.property);
		else styles.set(operation.property, operation.value);
		if (!styleMatch && styles.size === 0) return html;
		const quote = styleMatch?.[1] ?? '"';
		const serialized = Array.from(styles.entries())
			.map(
				([property, value]) =>
					`${property}: ${escapeHtmlAttribute({ value, quote })}`,
			)
			.join("; ");
		const nextTag = styleMatch
			? tag.replace(styleMatch[0], `style=${quote}${serialized}${quote}`)
			: tag.replace(
					/\s*\/?>$/,
					` style="${serialized}"${/\/\s*>$/.test(tag) ? " />" : ">"}`,
				);
		return replaceSourceTag({ html, match, tag: nextTag });
	}

	const attribute =
		operation.type === "attribute" && !operation.property.startsWith("data-")
			? `data-${operation.property}`
			: operation.property;
	const attributePattern = new RegExp(
		`\\s+${escapeRegExp(attribute)}(?:\\s*=\\s*(["'])[^"']*\\1)?`,
		"i",
	);
	if (operation.value === null) {
		if (!attributePattern.test(tag)) return html;
		return replaceSourceTag({
			html,
			match,
			tag: tag.replace(attributePattern, ""),
		});
	}
	const escaped = escapeHtmlAttribute({ value: operation.value, quote: '"' });
	const nextTag = attributePattern.test(tag)
		? tag.replace(attributePattern, ` ${attribute}="${escaped}"`)
		: tag.replace(
				/\s*\/?>$/,
				` ${attribute}="${escaped}"${/\/\s*>$/.test(tag) ? " />" : ">"}`,
			);
	return replaceSourceTag({ html, match, tag: nextTag });
}

function matchingClosingTagIndex({
	html,
	match,
}: {
	html: string;
	match: SourceTagMatch;
}): number | null {
	if (
		/\/\s*>$/.test(match.tag) ||
		/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(
			match.tagName,
		)
	) {
		return match.end;
	}
	const pattern = new RegExp(
		`<\\/?${escapeRegExp(match.tagName)}\\b[^>]*>`,
		"gi",
	);
	pattern.lastIndex = match.end;
	let depth = 1;
	for (
		let candidate = pattern.exec(html);
		candidate;
		candidate = pattern.exec(html)
	) {
		if (candidate[0].startsWith("</")) depth -= 1;
		else if (!/\/\s*>$/.test(candidate[0])) depth += 1;
		if (depth === 0) return candidate.index;
	}
	return null;
}

function patchSourceByIdentity({
	html,
	layer,
	operation,
}: {
	html: string;
	layer: StudioLayer;
	operation: StudioPatchOperation;
}): string {
	const match = layer.hfId
		? findSourceTagByAttribute({
				html,
				attribute: "data-hf-id",
				value: layer.hfId,
			})
		: layer.id
			? findSourceTagByAttribute({ html, attribute: "id", value: layer.id })
			: null;
	if (!match) return html;
	if (operation.type !== "text-content") {
		return patchSourceTag({ html, match, operation });
	}
	const closingIndex = matchingClosingTagIndex({ html, match });
	if (closingIndex == null) return html;
	const escaped = operation.value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	return `${html.slice(0, match.end)}${escaped}${html.slice(closingIndex)}`;
}

function selectorForElement({
	element,
	root,
}: {
	element: Element;
	root: Element;
}): string {
	if (element.id) return `[id="${escapeSelectorValue(element.id)}"]`;
	const hfId = element.getAttribute("data-hf-id");
	if (hfId) return `[data-hf-id="${escapeSelectorValue(hfId)}"]`;

	const parts: string[] = [];
	let current: Element | null = element;
	while (current && current !== root) {
		let part = current.tagName.toLowerCase();
		const siblings = current.parentElement
			? Array.from(current.parentElement.children).filter(
					(sibling) => sibling.tagName === current?.tagName,
				)
			: [];
		if (siblings.length > 1) {
			part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
		}
		parts.unshift(part);
		current = current.parentElement;
	}
	const rootSelector = root.id
		? `[id="${escapeSelectorValue(root.id)}"]`
		: `[data-composition-id="${escapeSelectorValue(root.getAttribute("data-composition-id") ?? "")}"]`;
	return [rootSelector, ...parts].join(" > ");
}

function layerLabel({
	element,
	index,
}: {
	element: Element;
	index: number;
}): string {
	const explicit =
		element.getAttribute("data-label") ??
		element.getAttribute("aria-label") ??
		element.id;
	if (explicit?.trim()) return explicit.trim();
	const text = (element.textContent ?? "").trim().replace(/\s+/g, " ");
	if (text) return text.slice(0, 40);
	return `${element.tagName.toLowerCase()} ${index + 1}`;
}

export function parseStudioDocument(html: string): StudioDocument | null {
	if (typeof DOMParser === "undefined") return null;
	if (html === cachedDocumentHtml) return cachedDocument;
	const info = quickValidate(html);
	if (!info) {
		cachedDocumentHtml = html;
		cachedDocument = null;
		return null;
	}
	const doc = new DOMParser().parseFromString(html, "text/html");
	const root = doc.querySelector("[data-composition-id]");
	if (!root) {
		cachedDocumentHtml = html;
		cachedDocument = null;
		return null;
	}

	const layers = Array.from(root.querySelectorAll("[data-start]")).map(
		(element, index): StudioLayer => {
			const id = element.id || null;
			const hfId = element.getAttribute("data-hf-id");
			const selector = selectorForElement({ element, root });
			const key = id ?? hfId ?? selector;
			const duration = finiteNumber({
				value: element.getAttribute("data-duration"),
				fallback: info.durationSecs,
			});
			const hiddenValue = element.getAttribute("data-hidden")?.toLowerCase();
			const playbackStartAttribute = element.hasAttribute("data-media-start")
				? "media-start"
				: element.hasAttribute("data-playback-start")
					? "playback-start"
					: null;
			return {
				key,
				id,
				hfId,
				selector,
				label: layerLabel({ element, index }),
				tag: element.tagName.toLowerCase(),
				text: (element.textContent ?? "")
					.trim()
					.replace(/\s+/g, " ")
					.slice(0, 120),
				start: Math.max(
					0,
					finiteNumber({ value: element.getAttribute("data-start") }),
				),
				duration: Math.max(0.01, duration),
				track: Math.max(
					0,
					Math.round(
						finiteNumber({
							value: element.getAttribute("data-track-index"),
						}),
					),
				),
				playbackStart: playbackStartAttribute
					? Math.max(
							0,
							finiteNumber({
								value: element.getAttribute(`data-${playbackStartAttribute}`),
							}),
						)
					: null,
				playbackStartAttribute,
				hidden: hiddenValue === "true" || hiddenValue === "1",
				styles: parseInlineStyles(element.getAttribute("style")),
			};
		},
	);

	cachedDocumentHtml = html;
	cachedDocument = {
		compositionId: info.compositionId,
		duration: info.durationSecs,
		width: info.width,
		height: info.height,
		layers,
	};
	return cachedDocument;
}

function serializeDocument({
	doc,
	original,
}: {
	doc: Document;
	original: string;
}): string {
	const doctype = /^\s*<!doctype/i.test(original) ? "<!DOCTYPE html>\n" : "";
	return `${doctype}${doc.documentElement.outerHTML}`;
}

function findLayerElement({
	doc,
	layer,
}: {
	doc: Document;
	layer: StudioLayer;
}): Element | null {
	if (layer.id) return doc.getElementById(layer.id);
	if (layer.hfId) {
		return doc.querySelector(
			`[data-hf-id="${escapeSelectorValue(layer.hfId)}"]`,
		);
	}
	try {
		return doc.querySelector(layer.selector);
	} catch {
		return null;
	}
}

function applyDomPatch({
	element,
	operation,
}: {
	element: Element;
	operation: StudioPatchOperation;
}): void {
	if (operation.type === "inline-style") {
		const styled = element as Element & { style?: CSSStyleDeclaration };
		if (!styled.style) return;
		if (operation.value === null)
			styled.style.removeProperty(operation.property);
		else styled.style.setProperty(operation.property, operation.value);
		return;
	}
	if (operation.type === "attribute") {
		const attribute = operation.property.startsWith("data-")
			? operation.property
			: `data-${operation.property}`;
		if (operation.value === null) element.removeAttribute(attribute);
		else element.setAttribute(attribute, operation.value);
		return;
	}
	if (operation.type === "html-attribute") {
		if (operation.value === null) element.removeAttribute(operation.property);
		else element.setAttribute(operation.property, operation.value);
		return;
	}
	element.textContent = operation.value;
}

/**
 * Applies public Hyperframes source patches when an authored id is available.
 * Selector-only generated layers fall back to DOM mutation so they remain
 * visually editable instead of forcing the user into source mode.
 */
export async function applyStudioLayerPatches({
	html,
	layer,
	operations,
}: {
	html: string;
	layer: StudioLayer;
	operations: StudioPatchOperation[];
}): Promise<string> {
	let patched = html;
	if (layer.id) {
		const { applyPatch } = await import("@hyperframes/studio");
		for (const operation of operations) {
			const safeOperation =
				operation.type === "text-content"
					? {
							...operation,
							value: operation.value
								.replace(/&/g, "&amp;")
								.replace(/</g, "&lt;")
								.replace(/>/g, "&gt;"),
						}
					: operation;
			patched = applyPatch(patched, layer.id, safeOperation);
		}
		if (patched !== html) return patched;
	}
	if (layer.hfId) {
		for (const operation of operations) {
			patched = patchSourceByIdentity({ html: patched, layer, operation });
		}
		if (patched !== html) return patched;
	}

	if (typeof DOMParser === "undefined") return html;
	const doc = new DOMParser().parseFromString(html, "text/html");
	const element = findLayerElement({ doc, layer });
	if (!element) return html;
	for (const operation of operations) applyDomPatch({ element, operation });
	return serializeDocument({ doc, original: html });
}

export function patchCompositionAttribute({
	html,
	attribute,
	value,
}: {
	html: string;
	attribute: "duration" | "width" | "height";
	value: string;
}): string {
	const rootPattern =
		/(<[a-zA-Z][^<>]*\bdata-composition-id\s*=\s*["'][^"']+["'][^<>]*)(>)/;
	const rootMatch = rootPattern.exec(html);
	if (!rootMatch) return html;
	const tag = rootMatch[1];
	const fullAttribute = `data-${attribute}`;
	const attributePattern = new RegExp(
		`\\b${fullAttribute}\\s*=\\s*(["'])[^"']*\\1`,
		"i",
	);
	const nextTag = attributePattern.test(tag)
		? tag.replace(attributePattern, `${fullAttribute}="${value}"`)
		: `${tag} ${fullAttribute}="${value}"`;
	return `${html.slice(0, rootMatch.index)}${nextTag}>${html.slice(rootMatch.index + rootMatch[0].length)}`;
}

export async function deleteStudioLayer({
	html,
	layer,
}: {
	html: string;
	layer: StudioLayer;
}): Promise<string> {
	if (layer.id) {
		const { findElementBlock } = await import("@hyperframes/studio");
		const block = findElementBlock(html, layer.id);
		if (block) return `${html.slice(0, block.start)}${html.slice(block.end)}`;
	}
	if (layer.hfId) {
		const match = findSourceTagByAttribute({
			html,
			attribute: "data-hf-id",
			value: layer.hfId,
		});
		if (match) {
			const closingIndex = matchingClosingTagIndex({ html, match });
			if (closingIndex != null) {
				if (closingIndex === match.end) {
					return `${html.slice(0, match.start)}${html.slice(match.end)}`;
				}
				const closeEnd = html.indexOf(">", closingIndex);
				if (closeEnd >= 0) {
					return `${html.slice(0, match.start)}${html.slice(closeEnd + 1)}`;
				}
			}
		}
	}
	if (typeof DOMParser === "undefined") return html;
	const doc = new DOMParser().parseFromString(html, "text/html");
	const element = findLayerElement({ doc, layer });
	if (!element) return html;
	element.remove();
	return serializeDocument({ doc, original: html });
}

export function isValidStudioDocument(html: string): boolean {
	return quickValidate(html) !== null;
}

export function postStudioPreviewAction({
	iframe,
	action,
	payload = {},
}: {
	iframe: HTMLIFrameElement | null;
	action: string;
	payload?: Record<string, unknown>;
}): void {
	iframe?.contentWindow?.postMessage(
		{ source: "hf-parent", type: "control", action, ...payload },
		"*",
	);
}
