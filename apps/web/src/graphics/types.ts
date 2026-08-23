import type { ParamDefinition, ParamValues } from "@/params";

export const DEFAULT_GRAPHIC_SOURCE_SIZE = 512;

export interface GraphicRenderContext {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	params: ParamValues;
	width: number;
	height: number;
	/**
	 * Seconds since the element's local start. Only provided when the
	 * definition opts into time-driven rendering via `animated`.
	 */
	localTime?: number;
	/** Element duration in seconds. Only provided for animated definitions. */
	durationSec?: number;
}

export interface GraphicDefinition {
	id: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	/**
	 * When true, the render output depends on `localTime` and is re-rendered
	 * every frame instead of being cached per param set.
	 */
	animated?: boolean;
	/** Source canvas width. Defaults to DEFAULT_GRAPHIC_SOURCE_SIZE. */
	sourceWidth?: number;
	/** Source canvas height. Defaults to DEFAULT_GRAPHIC_SOURCE_SIZE. */
	sourceHeight?: number;
	render(context: GraphicRenderContext): void;
}

export interface GraphicInstance {
	definitionId: string;
	params: ParamValues;
}
