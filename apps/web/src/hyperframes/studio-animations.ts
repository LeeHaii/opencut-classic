import {
	gsapAnimationsToKeyframes,
	parseGsapScript,
	type GsapAnimation,
} from "@hyperframes/parsers/gsap-parser";
import type { StudioLayer } from "./studio-document";

interface InlineScript {
	content: string;
	contentStart: number;
	contentEnd: number;
	animations: GsapAnimation[];
}

const SCRIPT_CACHE_LIMIT = 2;
const inlineScriptCache: Array<{ html: string; scripts: InlineScript[] }> = [];
const authoredDocumentCache: Array<{ html: string; document: Document }> = [];

export interface StudioAnimationKeyframe {
	animationId: string;
	percentage: number;
	clipPercentage: number;
	propertyGroup: string;
	properties: Record<string, number | string>;
	ease?: string;
	synthesized?: boolean;
	editability?: "direct" | "source";
}

export interface StudioRuntimeAnimation {
	id: string;
	targetKeys: string[];
	targetSelector: string;
	start: number;
	duration: number;
	propertyGroup: string;
	properties: Record<string, number | string>;
	keyframes: Array<{
		percentage: number;
		properties: Record<string, number | string>;
		ease?: string;
	}>;
}

export interface StudioRuntimeMotionSnapshot {
	compositionId: string;
	animations: StudioRuntimeAnimation[];
}

function isRuntimeProperties(
	value: unknown,
): value is Record<string, number | string> {
	if (typeof value !== "object" || value == null || Array.isArray(value)) {
		return false;
	}
	const entries = Object.entries(value);
	return (
		entries.length <= 64 &&
		entries.every(
			([property, propertyValue]) =>
				property.length <= 100 &&
				(typeof propertyValue === "string" ||
					(typeof propertyValue === "number" &&
						Number.isFinite(propertyValue))),
		)
	);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value != null && !Array.isArray(value);
}

/** Validate the bounded, data-only payload crossing the sandbox boundary. */
export function parseStudioRuntimeMotionSnapshot(
	value: unknown,
): StudioRuntimeMotionSnapshot | null {
	if (!isUnknownRecord(value)) return null;
	const snapshot = value;
	if (
		typeof snapshot.compositionId !== "string" ||
		snapshot.compositionId.length > 200 ||
		!Array.isArray(snapshot.animations) ||
		snapshot.animations.length > 2_000
	) {
		return null;
	}
	const animations: StudioRuntimeAnimation[] = [];
	for (const candidate of snapshot.animations) {
		if (!isUnknownRecord(candidate)) return null;
		const animation = candidate;
		if (
			typeof animation.id !== "string" ||
			animation.id.length > 512 ||
			typeof animation.targetSelector !== "string" ||
			animation.targetSelector.length > 1_000 ||
			!Array.isArray(animation.targetKeys) ||
			animation.targetKeys.length > 64 ||
			!animation.targetKeys.every(
				(key) => typeof key === "string" && key.length <= 1_000,
			) ||
			typeof animation.start !== "number" ||
			!Number.isFinite(animation.start) ||
			typeof animation.duration !== "number" ||
			!Number.isFinite(animation.duration) ||
			animation.duration <= 0 ||
			typeof animation.propertyGroup !== "string" ||
			animation.propertyGroup.length > 100 ||
			!isRuntimeProperties(animation.properties) ||
			!Array.isArray(animation.keyframes) ||
			animation.keyframes.length > 100
		) {
			return null;
		}
		const keyframes: StudioRuntimeAnimation["keyframes"] = [];
		for (const candidateKeyframe of animation.keyframes) {
			if (!isUnknownRecord(candidateKeyframe)) {
				return null;
			}
			const keyframe = candidateKeyframe;
			if (
				typeof keyframe.percentage !== "number" ||
				!Number.isFinite(keyframe.percentage) ||
				!isRuntimeProperties(keyframe.properties) ||
				(keyframe.ease != null && typeof keyframe.ease !== "string")
			) {
				return null;
			}
			keyframes.push({
				percentage: clampPercentage(keyframe.percentage),
				properties: keyframe.properties,
				...(typeof keyframe.ease === "string"
					? { ease: keyframe.ease.slice(0, 200) }
					: {}),
			});
		}
		animations.push({
			id: animation.id,
			targetKeys: animation.targetKeys,
			targetSelector: animation.targetSelector,
			start: animation.start,
			duration: animation.duration,
			propertyGroup: animation.propertyGroup,
			properties: animation.properties,
			keyframes,
		});
	}
	return { compositionId: snapshot.compositionId, animations };
}

export interface StudioLayerAnimations {
	animations: GsapAnimation[];
	runtimeAnimations: StudioRuntimeAnimation[];
	keyframes: StudioAnimationKeyframe[];
	diagnostics: Array<{
		kind: "runtime-only" | "unresolved-selector";
		message: string;
	}>;
}

const PROPERTY_DEFAULTS: Record<string, number> = {
	opacity: 1,
	x: 0,
	y: 0,
	scale: 1,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	width: 100,
	height: 100,
};

function readInlineScripts(html: string): InlineScript[] {
	const cachedIndex = inlineScriptCache.findIndex(
		(entry) => entry.html === html,
	);
	if (cachedIndex >= 0) {
		const [cached] = inlineScriptCache.splice(cachedIndex, 1);
		if (cached) {
			inlineScriptCache.unshift(cached);
			return cached.scripts;
		}
	}
	const scripts: InlineScript[] = [];
	const pattern = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
	for (const match of html.matchAll(pattern)) {
		if (match.index == null) continue;
		const content = match[1] ?? "";
		try {
			const parsed = parseGsapScript(content);
			if (parsed.animations.length === 0) continue;
			const openTagLength = match[0].indexOf(">") + 1 || 0;
			const contentStart = match.index + openTagLength;
			scripts.push({
				content,
				contentStart,
				contentEnd: contentStart + content.length,
				animations: parsed.animations,
			});
		} catch {
			// A composition may contain unrelated inline JavaScript. The visual
			// editor ignores scripts that are not statically parseable GSAP.
		}
	}
	inlineScriptCache.unshift({ html, scripts });
	if (inlineScriptCache.length > SCRIPT_CACHE_LIMIT) inlineScriptCache.pop();
	return scripts;
}

function readAuthoredDocument(html: string): Document | null {
	if (typeof DOMParser === "undefined") return null;
	const cachedIndex = authoredDocumentCache.findIndex(
		(entry) => entry.html === html,
	);
	if (cachedIndex >= 0) {
		const [cached] = authoredDocumentCache.splice(cachedIndex, 1);
		if (cached) {
			authoredDocumentCache.unshift(cached);
			return cached.document;
		}
	}
	const document = new DOMParser().parseFromString(html, "text/html");
	authoredDocumentCache.unshift({ html, document });
	if (authoredDocumentCache.length > SCRIPT_CACHE_LIMIT) {
		authoredDocumentCache.pop();
	}
	return document;
}

function targetMatchesLayer({
	target,
	layer,
	html,
}: {
	target: string;
	layer: StudioLayer;
	html: string;
}): boolean {
	const targets = target.split(",").map((value) => value.trim());
	if (
		targets.some((candidate) => {
			if (candidate === layer.selector) return true;
			if (layer.id && candidate === `#${layer.id}`) return true;
			if (layer.id && candidate === `[id="${layer.id}"]`) return true;
			if (layer.hfId && candidate === `[data-hf-id="${layer.hfId}"]`) {
				return true;
			}
			return false;
		})
	)
		return true;

	// Resolve the selector against the authored document. This gives class,
	// grouped and descendant selectors the same element semantics as GSAP while
	// keeping the preview iframe cross-origin sandbox intact.
	if (target === "__unresolved__") {
		return false;
	}
	try {
		const doc = readAuthoredDocument(html);
		if (!doc) return false;
		const layerElement = layer.id
			? doc.getElementById(layer.id)
			: layer.hfId
				? doc.querySelector(
						`[data-hf-id="${layer.hfId.replace(/(["\\])/g, "\\$1")}"]`,
					)
				: doc.querySelector(layer.selector);
		if (!layerElement) return false;
		return targets.some((candidate) => {
			try {
				return Array.from(doc.querySelectorAll(candidate)).includes(
					layerElement,
				);
			} catch {
				return false;
			}
		});
	} catch {
		return false;
	}
}

function animationStart(animation: GsapAnimation): number {
	if (Number.isFinite(animation.resolvedStart)) {
		return animation.resolvedStart ?? 0;
	}
	return typeof animation.position === "number" ? animation.position : 0;
}

export function studioTweenPercentageForClipPercentage({
	animation,
	layer,
	clipPercentage,
}: {
	animation: GsapAnimation;
	layer: StudioLayer;
	clipPercentage: number;
}): number | null {
	const duration = Math.max(0, animation.duration ?? layer.duration);
	if (duration <= 0) return null;
	const absoluteTime =
		layer.start + (layer.duration * clampPercentage(clipPercentage)) / 100;
	return clampPercentage(
		((absoluteTime - animationStart(animation)) / duration) * 100,
	);
}

function clampPercentage(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function synthesizeFlatTweenKeyframes(animation: GsapAnimation) {
	const immediateRenderHold =
		animation.extras?.immediateRender === "__raw:true";
	if (
		animation.method === "set" ||
		(animation.duration === 0 && immediateRenderHold)
	) {
		return [];
	}
	const toProperties = animation.properties;
	if (!toProperties || Object.keys(toProperties).length === 0) return [];
	const start: Record<string, number | string> = {};
	const end: Record<string, number | string> = {};
	if (animation.method === "from") {
		for (const [property, value] of Object.entries(toProperties)) {
			start[property] = value;
			end[property] = PROPERTY_DEFAULTS[property] ?? 0;
		}
	} else if (animation.method === "fromTo" && animation.fromProperties) {
		Object.assign(start, animation.fromProperties);
		Object.assign(end, toProperties);
	} else {
		for (const [property, value] of Object.entries(toProperties)) {
			start[property] = PROPERTY_DEFAULTS[property] ?? 0;
			end[property] = value;
		}
	}
	const numericProperties = Object.keys(end).filter(
		(property) =>
			typeof start[property] === "number" && typeof end[property] === "number",
	);
	if (numericProperties.length === 0) return [];
	return [
		{
			percentage: 0,
			properties: Object.fromEntries(
				numericProperties.map((property) => [property, start[property]]),
			),
		},
		{
			percentage: 100,
			properties: Object.fromEntries(
				numericProperties.map((property) => [property, end[property]]),
			),
			ease: animation.ease,
		},
	];
}

function runtimeTargetsLayer({
	animation,
	layer,
}: {
	animation: StudioRuntimeAnimation;
	layer: StudioLayer;
}): boolean {
	return animation.targetKeys.some(
		(key) =>
			key === layer.key ||
			(layer.id != null && key === layer.id) ||
			(layer.hfId != null && key === layer.hfId) ||
			key === layer.selector,
	);
}

export function getStudioLayerAnimations({
	html,
	layer,
	runtimeSnapshot,
}: {
	html: string;
	layer: StudioLayer;
	runtimeSnapshot?: StudioRuntimeMotionSnapshot | null;
}): StudioLayerAnimations {
	const animations = readInlineScripts(html)
		.flatMap((script) => script.animations)
		.filter((animation) =>
			targetMatchesLayer({ target: animation.targetSelector, layer, html }),
		);
	const keyframes = animations.flatMap((animation) => {
		const authored = animation.keyframes?.keyframes;
		const source = authored ?? synthesizeFlatTweenKeyframes(animation);
		if (source.length === 0) return [];
		const start = animationStart(animation);
		const duration = Math.max(0, animation.duration ?? layer.duration);
		return source.map(
			(keyframe): StudioAnimationKeyframe => ({
				animationId: animation.id,
				percentage: keyframe.percentage,
				clipPercentage: clampPercentage(
					((start + (duration * keyframe.percentage) / 100 - layer.start) /
						layer.duration) *
						100,
				),
				propertyGroup: animation.propertyGroup ?? "animation",
				properties: keyframe.properties,
				ease: keyframe.ease,
				synthesized: authored == null,
				editability: "direct",
			}),
		);
	});
	const runtimeAnimations = (runtimeSnapshot?.animations ?? []).filter(
		(animation) =>
			runtimeTargetsLayer({ animation, layer }) &&
			!animations.some(
				(authored) =>
					Math.abs(animation.start - animationStart(authored)) < 0.001 &&
					Math.abs(animation.duration - (authored.duration ?? layer.duration)) <
						0.001,
			),
	);
	// Runtime scanning is a fallback for selectors or source constructs the AST
	// cannot attribute. Avoid drawing a second copy when static discovery already
	// found an authored tween for this layer.
	for (const animation of runtimeAnimations) {
		for (const keyframe of animation.keyframes) {
			keyframes.push({
				animationId: animation.id,
				percentage: keyframe.percentage,
				clipPercentage: clampPercentage(
					((animation.start +
						(animation.duration * keyframe.percentage) / 100 -
						layer.start) /
						layer.duration) *
						100,
				),
				propertyGroup: animation.propertyGroup,
				properties: keyframe.properties,
				ease: keyframe.ease,
				synthesized: true,
				editability: "source",
			});
		}
	}
	const diagnostics: StudioLayerAnimations["diagnostics"] = [];
	if (runtimeAnimations.length > 0) {
		diagnostics.push({
			kind: "runtime-only",
			message:
				"This motion was discovered in the running preview. It is visible but must be edited in Source until it can be mapped to a literal tween.",
		});
	}
	if (
		animations.length === 0 &&
		readInlineScripts(html)
			.flatMap((script) => script.animations)
			.some((animation) => animation.hasUnresolvedSelector)
	) {
		diagnostics.push({
			kind: "unresolved-selector",
			message:
				"The source contains a dynamically computed GSAP selector that cannot be edited statically.",
		});
	}
	return {
		animations,
		runtimeAnimations,
		keyframes: keyframes.sort((a, b) => a.clipPercentage - b.clipPercentage),
		diagnostics,
	};
}

export function buildStudioTimelineKeyframes({
	html,
	layer,
	runtimeSnapshot,
}: {
	html: string;
	layer: StudioLayer;
	runtimeSnapshot?: StudioRuntimeMotionSnapshot | null;
}) {
	const { animations, runtimeAnimations, keyframes } = getStudioLayerAnimations(
		{
			html,
			layer,
			runtimeSnapshot,
		},
	);
	if (animations.length === 0 && runtimeAnimations.length === 0) return null;

	// The Studio store consumes its parser-native animations for expanded lanes.
	// The compact cache is kept separately for the diamonds on collapsed clips.
	return {
		animations,
		cache:
			keyframes.length > 0
				? {
						format: "percentage",
						keyframes: keyframes.map((keyframe) => ({
							percentage: keyframe.clipPercentage,
							tweenPercentage: keyframe.percentage,
							propertyGroup: keyframe.propertyGroup,
							animationId: keyframe.animationId,
							properties: keyframe.properties,
							ease: keyframe.ease,
						})),
					}
				: undefined,
	};
}

async function mutateAnimationScript({
	html,
	animationId,
	mutate,
}: {
	html: string;
	animationId: string;
	mutate: (script: string) => Promise<string> | string;
}): Promise<string> {
	const script = readInlineScripts(html).find((candidate) =>
		candidate.animations.some((animation) => animation.id === animationId),
	);
	if (!script) return html;
	const nextContent = await mutate(script.content);
	if (nextContent === script.content) return html;
	return `${html.slice(0, script.contentStart)}${nextContent}${html.slice(script.contentEnd)}`;
}

async function mutateInlineScripts({
	html,
	mutate,
}: {
	html: string;
	mutate: (script: string) => string;
}): Promise<string> {
	let patched = html;
	const scripts = readInlineScripts(html);
	for (const script of scripts.slice().reverse()) {
		const nextContent = mutate(script.content);
		if (nextContent === script.content) continue;
		patched = `${patched.slice(0, script.contentStart)}${nextContent}${patched.slice(script.contentEnd)}`;
	}
	return patched;
}

function animationTargetsForLayer({
	html,
	layer,
}: {
	html: string;
	layer: StudioLayer;
}): string[] {
	return [
		...new Set(
			getStudioLayerAnimations({ html, layer }).animations.map(
				(animation) => animation.targetSelector,
			),
		),
	];
}

export async function shiftStudioLayerAnimations({
	html,
	layer,
	delta,
}: {
	html: string;
	layer: StudioLayer;
	delta: number;
}): Promise<string> {
	if (Math.abs(delta) < 0.000_001) return html;
	const targets = animationTargetsForLayer({ html, layer });
	if (targets.length === 0) return html;
	const { shiftPositionsInScript } =
		await import("@hyperframes/parsers/gsap-writer-acorn");
	return mutateInlineScripts({
		html,
		mutate: (script) =>
			targets.reduce(
				(current, target) => shiftPositionsInScript(current, target, delta),
				script,
			),
	});
}

export async function scaleStudioLayerAnimations({
	html,
	layer,
	start,
	duration,
}: {
	html: string;
	layer: StudioLayer;
	start: number;
	duration: number;
}): Promise<string> {
	if (
		Math.abs(start - layer.start) < 0.000_001 &&
		Math.abs(duration - layer.duration) < 0.000_001
	) {
		return html;
	}
	const targets = animationTargetsForLayer({ html, layer });
	if (targets.length === 0) return html;
	const { scalePositionsInScript } =
		await import("@hyperframes/parsers/gsap-writer-acorn");
	return mutateInlineScripts({
		html,
		mutate: (script) =>
			targets.reduce(
				(current, target) =>
					scalePositionsInScript(
						current,
						target,
						layer.start,
						layer.duration,
						start,
						duration,
					),
				script,
			),
	});
}

export async function moveStudioKeyframe({
	html,
	animationId,
	fromPercentage,
	toPercentage,
	convertFlat = false,
}: {
	html: string;
	animationId: string;
	fromPercentage: number;
	toPercentage: number;
	convertFlat?: boolean;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { convertToKeyframesFromScript, moveKeyframeInScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			const editableScript = convertFlat
				? convertToKeyframesFromScript(script, animationId)
				: script;
			return moveKeyframeInScript(
				editableScript,
				animationId,
				fromPercentage,
				toPercentage,
			);
		},
	});
}

export async function addStudioKeyframe({
	html,
	animationId,
	percentage,
	properties,
	ease,
	convertFlat = false,
}: {
	html: string;
	animationId: string;
	percentage: number;
	properties: Record<string, number | string>;
	ease?: string;
	convertFlat?: boolean;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { addKeyframeToScript, convertToKeyframesFromScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			const editableScript = convertFlat
				? convertToKeyframesFromScript(script, animationId)
				: script;
			return addKeyframeToScript(
				editableScript,
				animationId,
				clampPercentage(percentage),
				properties,
				ease,
			);
		},
	});
}

export function interpolateStudioKeyframeProperties({
	keyframes,
	percentage,
}: {
	keyframes: StudioAnimationKeyframe[];
	percentage: number;
}): Record<string, number | string> {
	const ordered = [...keyframes].sort((a, b) => a.percentage - b.percentage);
	if (ordered.length === 0) return {};
	const target = clampPercentage(percentage);
	const before =
		[...ordered].reverse().find((keyframe) => keyframe.percentage <= target) ??
		ordered[0];
	const after =
		ordered.find((keyframe) => keyframe.percentage >= target) ??
		ordered[ordered.length - 1];
	if (!before || !after) return {};
	if (before.percentage === after.percentage) return { ...before.properties };
	const progress =
		(target - before.percentage) / (after.percentage - before.percentage);
	const properties: Record<string, number | string> = {};
	for (const property of new Set([
		...Object.keys(before.properties),
		...Object.keys(after.properties),
	])) {
		const start = before.properties[property];
		const end = after.properties[property];
		if (typeof start === "number" && typeof end === "number") {
			properties[property] =
				Math.round((start + (end - start) * progress) * 1_000) / 1_000;
		} else if (progress < 0.5 && start != null) {
			properties[property] = start;
		} else if (end != null) {
			properties[property] = end;
		}
	}
	return properties;
}

export async function removeStudioKeyframe({
	html,
	animationId,
	percentage,
	convertFlat = false,
}: {
	html: string;
	animationId: string;
	percentage: number;
	convertFlat?: boolean;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { convertToKeyframesFromScript, removeKeyframeFromScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			const editableScript = convertFlat
				? convertToKeyframesFromScript(script, animationId)
				: script;
			return removeKeyframeFromScript(editableScript, animationId, percentage);
		},
	});
}

export async function convertStudioAnimationToKeyframes({
	html,
	animationId,
}: {
	html: string;
	animationId: string;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { convertToKeyframesFromScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			return convertToKeyframesFromScript(script, animationId);
		},
	});
}

export async function removeAllStudioKeyframes({
	html,
	animationId,
	convertFlat = false,
}: {
	html: string;
	animationId: string;
	convertFlat?: boolean;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { convertToKeyframesFromScript, removeAllKeyframesFromScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			const editableScript = convertFlat
				? convertToKeyframesFromScript(script, animationId)
				: script;
			return removeAllKeyframesFromScript(editableScript, animationId);
		},
	});
}

export async function updateStudioKeyframe({
	html,
	animationId,
	percentage,
	properties,
	ease,
	convertFlat = false,
}: {
	html: string;
	animationId: string;
	percentage: number;
	properties: Record<string, number | string>;
	ease?: string;
	convertFlat?: boolean;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { convertToKeyframesFromScript, updateKeyframeInScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			const editableScript = convertFlat
				? convertToKeyframesFromScript(script, animationId)
				: script;
			return updateKeyframeInScript(
				editableScript,
				animationId,
				percentage,
				properties,
				ease,
			);
		},
	});
}

/** Converts parser output to a simple inspector readout for flat tweens. */
export function getStudioAnimationSummary(animation: GsapAnimation) {
	let inferredKeyframes = 0;
	try {
		inferredKeyframes = gsapAnimationsToKeyframes([animation], 0, {
			clampTimeToZero: true,
			skipBaseSet: true,
		}).length;
	} catch {
		// Dynamic tweens still appear in the inspector, but without inferred keys.
	}
	return {
		start: animationStart(animation),
		duration: Math.max(0, animation.duration ?? 0),
		keyframeCount: animation.keyframes?.keyframes.length ?? inferredKeyframes,
	};
}
