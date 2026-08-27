import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { entranceProgress, exitFactor, staggeredProgress } from "../animation";
import {
	accent,
	drawGlassCard,
	setFont,
	textParam,
	withAlpha,
	TEXT_PRIMARY,
	wrapLines,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface QuoteParams {
	quote: string;
	author: string;
	accentColor: string;
}

const QUOTE_PARAMS: ParamDefinition<keyof QuoteParams & string>[] = [
	{
		key: "quote",
		label: "Quote",
		type: "text",
		default: "The best way to predict the future is to invent it.",
	},
	{ key: "author", label: "Author", type: "text", default: "Alan Kay" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#a78bfa" },
];

function renderQuote({
	ctx,
	params,
	width,
	height,
	localTime = 0,
	durationSec = 5,
}: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const cardEnter = entranceProgress({ localTime });
	const textEnter = staggeredProgress({ localTime, index: 1 });
	const authorEnter = staggeredProgress({ localTime, index: 2 });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });
	const quote = textParam({ params, key: "quote" });
	const author = textParam({ params, key: "author" });

	ctx.save();
	ctx.globalAlpha = exit;

	const cardWidth = width * 0.62;
	const cardX = (width - cardWidth) / 2;
	const cardY = height * 0.18 + 30 * (1 - cardEnter);
	drawGlassCard({
		ctx,
		x: cardX,
		y: cardY,
		width: cardWidth,
		height: height * 0.52,
		radius: 28,
	});

	ctx.fillStyle = color;
	setFont({ ctx, size: height * 0.16, weight: 800 });
	ctx.globalAlpha = exit * cardEnter;
	ctx.fillText("\u201C", cardX + 36, cardY + height * 0.17);

	setFont({ ctx, size: height * 0.052, weight: 600 });
	ctx.fillStyle = TEXT_PRIMARY;
	ctx.globalAlpha = exit * textEnter;
	const lines = wrapLines({ ctx, text: quote, maxWidth: cardWidth - 120 });
	lines.forEach((line, index) => {
		ctx.fillText(
			line,
			cardX + 60,
			cardY + height * 0.14 + index * height * 0.075,
		);
	});

	if (author) {
		setFont({ ctx, size: height * 0.038, weight: 700 });
		ctx.fillStyle = withAlpha({ hex: color, alpha: 0.95 });
		ctx.globalAlpha = exit * authorEnter;
		ctx.fillText(`— ${author}`, cardX + 60, cardY + height * 0.44);
	}
	ctx.restore();
}

export const quoteTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.quote",
		name: "Quote Card",
		category: "Editorial",
		description: "Glassy centered quotation with attribution.",
		defaultDurationSec: 5,
	},
	definition: {
		id: "rhymx.quote",
		name: "Quote Card",
		keywords: ["quote", "citation", "editorial"],
		params: QUOTE_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderQuote,
	} satisfies GraphicDefinition,
};
