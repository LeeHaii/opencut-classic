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

export interface StudioAnimationKeyframe {
	animationId: string;
	percentage: number;
	clipPercentage: number;
	propertyGroup: string;
	properties: Record<string, number | string>;
	ease?: string;
}

export interface StudioLayerAnimations {
	animations: GsapAnimation[];
	keyframes: StudioAnimationKeyframe[];
}

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

function targetMatchesLayer({
	target,
	layer,
}: {
	target: string;
	layer: StudioLayer;
}): boolean {
	const targets = target.split(",").map((value) => value.trim());
	return targets.some((candidate) => {
		if (candidate === layer.selector) return true;
		if (layer.id && candidate === `#${layer.id}`) return true;
		if (layer.id && candidate === `[id="${layer.id}"]`) return true;
		if (layer.hfId && candidate === `[data-hf-id="${layer.hfId}"]`) {
			return true;
		}
		return false;
	});
}

function animationStart(animation: GsapAnimation): number {
	if (Number.isFinite(animation.resolvedStart)) {
		return animation.resolvedStart ?? 0;
	}
	return typeof animation.position === "number" ? animation.position : 0;
}

function clampPercentage(value: number): number {
	return Math.max(0, Math.min(100, value));
}

export function getStudioLayerAnimations({
	html,
	layer,
}: {
	html: string;
	layer: StudioLayer;
}): StudioLayerAnimations {
	const animations = readInlineScripts(html)
		.flatMap((script) => script.animations)
		.filter((animation) =>
			targetMatchesLayer({ target: animation.targetSelector, layer }),
		);
	const keyframes = animations.flatMap((animation) => {
		if (!animation.keyframes) return [];
		const start = animationStart(animation);
		const duration = Math.max(0, animation.duration ?? 0);
		return animation.keyframes.keyframes.map(
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
			}),
		);
	});
	return {
		animations,
		keyframes: keyframes.sort((a, b) => a.clipPercentage - b.clipPercentage),
	};
}

export function buildStudioTimelineKeyframes({
	html,
	layer,
}: {
	html: string;
	layer: StudioLayer;
}) {
	const { animations, keyframes } = getStudioLayerAnimations({ html, layer });
	if (animations.length === 0) return null;

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
}: {
	html: string;
	animationId: string;
	fromPercentage: number;
	toPercentage: number;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { moveKeyframeInScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			return moveKeyframeInScript(
				script,
				animationId,
				fromPercentage,
				toPercentage,
			);
		},
	});
}

export async function removeStudioKeyframe({
	html,
	animationId,
	percentage,
}: {
	html: string;
	animationId: string;
	percentage: number;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { removeKeyframeFromScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			return removeKeyframeFromScript(script, animationId, percentage);
		},
	});
}

export async function updateStudioKeyframe({
	html,
	animationId,
	percentage,
	properties,
	ease,
}: {
	html: string;
	animationId: string;
	percentage: number;
	properties: Record<string, number | string>;
	ease?: string;
}): Promise<string> {
	return mutateAnimationScript({
		html,
		animationId,
		mutate: async (script) => {
			const { updateKeyframeInScript } =
				await import("@hyperframes/parsers/gsap-writer-acorn");
			return updateKeyframeInScript(
				script,
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
