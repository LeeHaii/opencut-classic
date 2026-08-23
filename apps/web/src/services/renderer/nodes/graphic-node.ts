import { createCanvasSurface } from "../canvas-utils";
import {
	DEFAULT_GRAPHIC_SOURCE_SIZE,
	getGraphicDefinition,
	registerDefaultGraphics,
} from "@/graphics";
import type { ParamValues } from "@/params";
import { TICKS_PER_SECOND } from "@/wasm";
import {
	VisualNode,
	type ResolvedVisualNodeState,
	type VisualNodeParams,
} from "./visual-node";

export interface GraphicNodeParams extends VisualNodeParams {
	definitionId: string;
	params: ParamValues;
}

export interface ResolvedGraphicNodeState extends ResolvedVisualNodeState {
	resolvedParams: ParamValues;
}

/** Millisecond quantization keeps the per-frame cache key stable across re-renders of the same frame. */
const ANIMATION_CACHE_QUANTUM_MS = 1;

export class GraphicNode extends VisualNode<
	GraphicNodeParams,
	ResolvedGraphicNodeState
> {
	private cachedKey: string | null = null;
	private cachedSource: OffscreenCanvas | null = null;

	constructor(params: GraphicNodeParams) {
		super(params);
		registerDefaultGraphics();
	}

	getSource({
		resolvedParams,
		localTimeSec,
	}: {
		resolvedParams: ParamValues;
		localTimeSec?: number;
	}): OffscreenCanvas {
		const definition = getGraphicDefinition({
			definitionId: this.params.definitionId,
		});
		const width = definition.sourceWidth ?? DEFAULT_GRAPHIC_SOURCE_SIZE;
		const height = definition.sourceHeight ?? DEFAULT_GRAPHIC_SOURCE_SIZE;
		const animated = definition.animated === true;
		const animationTime =
			animated && localTimeSec !== undefined
				? Math.max(
						0,
						Math.round(localTimeSec * 1000 * ANIMATION_CACHE_QUANTUM_MS) /
							(1000 * ANIMATION_CACHE_QUANTUM_MS),
					)
				: null;
		const cacheKey = JSON.stringify({
			definitionId: this.params.definitionId,
			params: resolvedParams,
			width,
			height,
			t: animationTime,
		});
		if (this.cachedSource && this.cachedKey === cacheKey) {
			return this.cachedSource;
		}

		const { canvas, context } = createCanvasSurface({
			width,
			height,
		});

		definition.render({
			ctx: context,
			params: resolvedParams,
			width,
			height,
			localTime: animationTime ?? undefined,
			durationSec:
				animationTime !== null
					? this.params.duration / TICKS_PER_SECOND
					: undefined,
		});

		this.cachedKey = cacheKey;
		this.cachedSource = canvas;
		return canvas;
	}
}
