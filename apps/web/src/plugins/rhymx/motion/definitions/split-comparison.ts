import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { entranceProgress, exitFactor, easeOutCubic, clamp01 } from "../animation";
import {
	accent,
	drawGlassCard,
	setFont,
	textParam,
	withAlpha,
	TEXT_PRIMARY,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface SplitComparisonParams {
	leftTitle: string;
	rightTitle: string;
	leftValue: string;
	rightValue: string;
	accentColor: string;
}

const SPLIT_PARAMS: ParamDefinition<keyof SplitComparisonParams & string>[] = [
	{ key: "leftTitle", label: "Left title", type: "text", default: "Before" },
	{ key: "rightTitle", label: "Right title", type: "text", default: "After" },
	{ key: "leftValue", label: "Left value", type: "text", default: "12 hrs" },
	{ key: "rightValue", label: "Right value", type: "text", default: "20 min" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#fb7185" },
];

function renderSplitComparison({ ctx, params, width, height, localTime = 0, durationSec = 5 }: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const enter = entranceProgress({ localTime });
	const leftEnter = easeOutCubic({ t: localTime / 0.7 });
	const rightEnter = easeOutCubic({ t: (localTime - 0.15) / 0.7 });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });

	ctx.save();
	ctx.globalAlpha = exit;

	const cardWidth = width * 0.34;
	const cardHeight = height * 0.44;
	const gap = width * 0.06;
	const centerY = height * 0.28 + 24 * (1 - enter);

	const cards = [
		{
			x: width / 2 - gap / 2 - cardWidth - (1 - leftEnter) * 80,
			title: textParam({ params, key: "leftTitle" }),
			value: textParam({ params, key: "leftValue" }),
			alpha: clamp01({ value: leftEnter }),
		},
		{
			x: width / 2 + gap / 2 + (1 - rightEnter) * 80,
			title: textParam({ params, key: "rightTitle" }),
			value: textParam({ params, key: "rightValue" }),
			alpha: clamp01({ value: rightEnter }),
		},
	];

	for (const card of cards) {
		ctx.globalAlpha = exit * card.alpha;
		drawGlassCard({
			ctx,
			x: card.x,
			y: centerY,
			width: cardWidth,
			height: cardHeight,
			radius: 26,
		});
		setFont({ ctx, size: height * 0.04, weight: 700 });
		ctx.fillStyle = withAlpha({ hex: color, alpha: 0.95 });
		ctx.textAlign = "center";
		ctx.fillText(card.title, card.x + cardWidth / 2, centerY + cardHeight * 0.28);
		setFont({ ctx, size: height * 0.11, weight: 800 });
		ctx.fillStyle = TEXT_PRIMARY;
		ctx.fillText(card.value, card.x + cardWidth / 2, centerY + cardHeight * 0.66);
	}

	ctx.textAlign = "left";
	ctx.restore();
}

export const splitComparisonTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.split-comparison",
		name: "Split Comparison",
		category: "Data",
		description: "Two staggered before/after value cards.",
		defaultDurationSec: 5,
	},
	definition: {
		id: "rhymx.split-comparison",
		name: "Split Comparison",
		keywords: ["comparison", "versus", "before after", "split"],
		params: SPLIT_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderSplitComparison,
	} satisfies GraphicDefinition,
};
