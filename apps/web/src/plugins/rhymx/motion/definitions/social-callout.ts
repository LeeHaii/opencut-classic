import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import {
	entranceProgress,
	exitFactor,
	staggeredProgress,
	clamp01,
} from "../animation";
import {
	accent,
	drawGlassCard,
	setFont,
	textParam,
	TEXT_PRIMARY,
	wrapLines,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface SocialCalloutParams {
	handle: string;
	message: string;
	accentColor: string;
}

const SOCIAL_PARAMS: ParamDefinition<keyof SocialCalloutParams & string>[] = [
	{ key: "handle", label: "Handle", type: "text", default: "@rhymx.studio" },
	{
		key: "message",
		label: "Message",
		type: "text",
		default: "Follow for part two",
	},
	{ key: "accentColor", label: "Accent", type: "color", default: "#e879f9" },
];

function renderSocialCallout({
	ctx,
	params,
	width,
	height,
	localTime = 0,
	durationSec = 4,
}: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const cardEnter = entranceProgress({ localTime });
	const textEnter = staggeredProgress({ localTime, index: 1 });
	const pulse = (Math.sin(localTime * Math.PI * 2.4) + 1) / 2;
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });

	ctx.save();
	ctx.globalAlpha = exit;

	const cardWidth = width * 0.4;
	const cardHeight = height * 0.3;
	const cardX = width / 2 - cardWidth / 2 + 26 * (1 - cardEnter);
	const cardY = height * 0.62 - cardHeight / 2;
	drawGlassCard({
		ctx,
		x: cardX,
		y: cardY,
		width: cardWidth,
		height: cardHeight,
		radius: 24,
	});

	ctx.fillStyle = color;
	ctx.globalAlpha = exit * clamp01({ value: 0.55 + pulse * 0.45 }) * cardEnter;
	ctx.beginPath();
	ctx.arc(
		cardX + 52,
		cardY + 52,
		height * 0.02 + pulse * height * 0.006,
		0,
		Math.PI * 2,
	);
	ctx.fill();

	ctx.globalAlpha = exit * textEnter;
	setFont({ ctx, size: height * 0.038, weight: 800 });
	ctx.fillStyle = color;
	ctx.fillText(textParam({ params, key: "handle" }), cardX + 84, cardY + 62);

	setFont({ ctx, size: height * 0.046, weight: 600 });
	ctx.fillStyle = TEXT_PRIMARY;
	const lines = wrapLines({
		ctx,
		text: textParam({ params, key: "message" }),
		maxWidth: cardWidth - 80,
	});
	lines.forEach((line, index) => {
		ctx.fillText(
			line,
			cardX + 40,
			cardY + cardHeight * 0.62 + index * height * 0.06,
		);
	});
	ctx.restore();
}

export const socialCalloutTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.social-callout",
		name: "Social Callout",
		category: "Calls to action",
		description: "Pulsing follow/subscribe glass card.",
		defaultDurationSec: 4,
	},
	definition: {
		id: "rhymx.social-callout",
		name: "Social Callout",
		keywords: ["social", "follow", "subscribe", "call to action"],
		params: SOCIAL_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderSocialCallout,
	} satisfies GraphicDefinition,
};
