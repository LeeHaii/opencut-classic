export const RHYMX_FONT_STACK = "Inter, 'Segoe UI', system-ui, sans-serif";

export const DEFAULT_ACCENT = "#22d3ee";
export const TEXT_PRIMARY = "#f8fafc";
export const CARD_BACKGROUND = "rgba(15, 23, 42, 0.72)";
export const CARD_BORDER = "rgba(148, 163, 184, 0.28)";

export function accent({
	params,
	fallback = DEFAULT_ACCENT,
}: {
	params: Record<string, unknown>;
	fallback?: string;
}): string {
	const value = params.accentColor;
	return typeof value === "string" && value.trim().length > 0
		? value
		: fallback;
}

export function textParam({
	params,
	key,
	fallback = "",
}: {
	params: Record<string, unknown>;
	key: string;
	fallback?: string;
}): string {
	const value = params[key];
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function numberParam({
	params,
	key,
	fallback = 0,
}: {
	params: Record<string, unknown>;
	key: string;
	fallback?: number;
}): number {
	const value = params[key];
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return fallback;
}

export function withAlpha({
	hex,
	alpha,
}: {
	hex: string;
	alpha: number;
}): string {
	const parsed = parseHex(hex);
	return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${Math.min(1, Math.max(0, alpha))})`;
}

export function mixWithAlpha({
	hex,
	overlay,
	alpha,
}: {
	hex: string;
	overlay: { r: number; g: number; b: number };
	alpha: number;
}): string {
	const base = parseHex(hex);
	const r = Math.round(base.r * (1 - alpha) + overlay.r * alpha);
	const g = Math.round(base.g * (1 - alpha) + overlay.g * alpha);
	const b = Math.round(base.b * (1 - alpha) + overlay.b * alpha);
	return `rgb(${r}, ${g}, ${b})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
	const normalized = hex.replace("#", "").trim();
	const full =
		normalized.length === 3
			? normalized
					.split("")
					.map((char) => char + char)
					.join("")
			: normalized.padEnd(6, "0").slice(0, 6);
	const value = Number.parseInt(full, 16);
	if (Number.isNaN(value)) {
		return { r: 34, g: 211, b: 238 };
	}
	return {
		r: (value >> 16) & 255,
		g: (value >> 8) & 255,
		b: value & 255,
	};
}

export function setFont({
	ctx,
	size,
	weight = 700,
	family = RHYMX_FONT_STACK,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	size: number;
	weight?: number;
	family?: string;
}): void {
	ctx.font = `${weight} ${size}px ${family}`;
}

export function wrapLines({
	ctx,
	text,
	maxWidth,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	text: string;
	maxWidth: number;
}): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return [];
	}
	const lines: string[] = [];
	let current = words[0];
	for (let index = 1; index < words.length; index++) {
		const candidate = `${current} ${words[index]}`;
		if (ctx.measureText(candidate).width <= maxWidth) {
			current = candidate;
		} else {
			lines.push(current);
			current = words[index];
		}
	}
	lines.push(current);
	return lines;
}

export function drawGlassCard({
	ctx,
	x,
	y,
	width,
	height,
	radius,
	borderColor = CARD_BORDER,
	background = CARD_BACKGROUND,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
	borderColor?: string;
	background?: string;
}): void {
	ctx.save();
	const path = new Path2D();
	path.roundRect(x, y, width, height, radius);
	ctx.fillStyle = background;
	ctx.fill(path);
	ctx.strokeStyle = borderColor;
	ctx.lineWidth = 2;
	ctx.stroke(path);
	ctx.restore();
}

export function roundRectPath({
	x,
	y,
	width,
	height,
	radius,
}: {
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
}): Path2D {
	const path = new Path2D();
	path.roundRect(x, y, width, height, radius);
	return path;
}
