import type { Mask } from "@/masks/types";
import {
	VisualNode,
	type ResolvedVisualSourceNodeState,
	type VisualNodeParams,
} from "./visual-node";

export interface HyperframesNodeParams extends VisualNodeParams {
	compositionId: string;
	html: string;
	width: number;
	height: number;
	masks?: Mask[];
}

export interface HyperframesRenderMeta {
	compositionId: string;
	htmlLength: number;
	width: number;
	height: number;
}

interface CachedPoster {
	source: HTMLCanvasElement;
	width: number;
	height: number;
}

const posterCache = new Map<string, CachedPoster>();

function posterCacheKey({
	compositionId,
	html,
	width,
	height,
}: HyperframesNodeParams): string {
	return `${compositionId}:${hashString(html)}:${width}x${height}`;
}

function hashString(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

/**
 * Draws the placeholder poster shown on the compositor canvas while an AI
 * scene has no rendered MP4 yet. Live HTML preview happens in the sandboxed
 * overlay above the canvas — this poster is what exports and distant zoom
 * levels see.
 */
export function loadHyperframesPoster(
	params: HyperframesNodeParams,
): Promise<CachedPoster> {
	const key = posterCacheKey(params);
	const cached = posterCache.get(key);
	if (cached) return Promise.resolve(cached);

	const { width, height, compositionId } = params;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return Promise.reject(new Error("2D context unavailable"));
	}

	const gradient = ctx.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, "#17171c");
	gradient.addColorStop(1, "#232338");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);

	ctx.strokeStyle = "rgba(255,255,255,0.08)";
	ctx.lineWidth = Math.max(1, height / 540);
	const step = height / 9;
	for (let x = step; x < width; x += step) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x - height * 0.35, height);
		ctx.stroke();
	}

	ctx.fillStyle = "rgba(255,255,255,0.92)";
	ctx.font = `700 ${Math.round(height * 0.06)}px system-ui, sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("AI Scene", width / 2, height / 2 - height * 0.03);

	ctx.fillStyle = "rgba(255,255,255,0.55)";
	ctx.font = `${Math.round(height * 0.032)}px system-ui, sans-serif`;
	ctx.fillText(compositionId, width / 2, height / 2 + height * 0.05);

	const poster = { source: canvas, width, height };
	posterCache.set(key, poster);
	if (posterCache.size > 32) {
		const firstKey = posterCache.keys().next().value;
		if (firstKey !== undefined) {
			posterCache.delete(firstKey);
		}
	}
	return Promise.resolve(poster);
}

export function getHyperframesRenderMeta(
	params: HyperframesNodeParams,
): HyperframesRenderMeta {
	return {
		compositionId: params.compositionId,
		htmlLength: params.html.length,
		width: params.width,
		height: params.height,
	};
}

export class HyperframesNode extends VisualNode<
	HyperframesNodeParams,
	ResolvedVisualSourceNodeState
> {}
