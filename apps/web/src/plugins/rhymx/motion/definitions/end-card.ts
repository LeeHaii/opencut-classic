import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import {
	entranceProgress,
	exitFactor,
	easeOutBack,
	clamp01,
} from "../animation";
import {
	accent,
	roundRectPath,
	setFont,
	textParam,
	withAlpha,
	TEXT_PRIMARY,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface EndCardParams {
	title: string;
	cta: string;
	accentColor: string;
}

const END_CARD_PARAMS: ParamDefinition<keyof EndCardParams & string>[] = [
	{
		key: "title",
		label: "Title",
		type: "text",
		default: "Thanks for watching",
	},
	{ key: "cta", label: "Button", type: "text", default: "Watch next" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#22d3ee" },
];

function renderEndCard({
	ctx,
	params,
	width,
	height,
	localTime = 0,
	durationSec = 4,
}: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const enter = entranceProgress({ localTime });
	const ctaPop = easeOutBack({ t: (localTime - 0.35) / 0.5 });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });

	ctx.save();
	ctx.globalAlpha = exit;
	ctx.fillStyle = "#020617";
	ctx.fillRect(0, 0, width, height);
	ctx.fillStyle = withAlpha({ hex: color, alpha: 0.08 * enter });
	ctx.beginPath();
	ctx.arc(width / 2, height / 2, height * (0.3 + enter * 0.25), 0, Math.PI * 2);
	ctx.fill();

	setFont({ ctx, size: height * 0.1 * (0.9 + 0.1 * enter), weight: 800 });
	ctx.fillStyle = TEXT_PRIMARY;
	ctx.textAlign = "center";
	ctx.globalAlpha = exit * clamp01({ value: enter * 1.2 });
	ctx.fillText(textParam({ params, key: "title" }), width / 2, height * 0.46);

	const ctaScale = clamp01({ value: ctaPop });
	if (ctaScale > 0) {
		const ctaText = textParam({ params, key: "cta" });
		setFont({ ctx, size: height * 0.042, weight: 800 });
		const textWidth = ctx.measureText(ctaText).width;
		const pillWidth = textWidth + width * 0.06;
		const pillHeight = height * 0.09;
		ctx.globalAlpha = exit;
		ctx.fillStyle = color;
		ctx.save();
		ctx.translate(width / 2, height * 0.62);
		ctx.scale(ctaScale, ctaScale);
		ctx.fill(
			roundRectPath({
				x: -pillWidth / 2,
				y: -pillHeight / 2,
				width: pillWidth,
				height: pillHeight,
				radius: pillHeight / 2,
			}),
		);
		ctx.fillStyle = "#0f172a";
		ctx.fillText(ctaText, -textWidth / 2, pillHeight * 0.18);
		ctx.restore();
	}
	ctx.textAlign = "left";
	ctx.restore();
}

export const endCardTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.end-card",
		name: "End Card",
		category: "Calls to action",
		description: "Closing title with CTA button pop.",
		defaultDurationSec: 4,
	},
	definition: {
		id: "rhymx.end-card",
		name: "End Card",
		keywords: ["end card", "outro", "call to action", "subscribe"],
		params: END_CARD_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderEndCard,
	} satisfies GraphicDefinition,
};
