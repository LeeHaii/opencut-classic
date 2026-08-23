import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { entranceProgress, exitFactor } from "../animation";
import {
	accent,
	numberParam,
	setFont,
	textParam,
	withAlpha,
	TEXT_PRIMARY,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface StatisticParams {
	value: string;
	suffix: string;
	label: string;
	accentColor: string;
}

const STATISTIC_PARAMS: ParamDefinition<keyof StatisticParams & string>[] = [
	{ key: "value", label: "Value", type: "text", default: "87" },
	{ key: "suffix", label: "Suffix", type: "text", default: "%" },
	{ key: "label", label: "Label", type: "text", default: "of viewers finish the video" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#f59e0b" },
];

function renderStatistic({ ctx, params, width, height, localTime = 0, durationSec = 4 }: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const enter = entranceProgress({ localTime });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });
	const target = numberParam({ params, key: "value", fallback: 0 });
	const suffix = textParam({ params, key: "suffix" });

	ctx.save();
	ctx.globalAlpha = exit;
	ctx.fillStyle = withAlpha({ hex: color, alpha: 0.12 * enter });
	ctx.beginPath();
	ctx.arc(width / 2, height / 2, height * 0.42 * enter, 0, Math.PI * 2);
	ctx.fill();

	const display = Math.round(target * enter).toLocaleString();
	setFont({ ctx, size: height * 0.24, weight: 800 });
	ctx.fillStyle = TEXT_PRIMARY;
	ctx.textAlign = "center";
	const textWidth = ctx.measureText(display + suffix).width;
	ctx.fillText(display + suffix, width / 2, height / 2 + height * 0.06);

	setFont({ ctx, size: height * 0.045, weight: 600 });
	ctx.fillStyle = color;
	ctx.fillText(
		textParam({ params, key: "label" }),
		width / 2,
		height / 2 + height * 0.16 + Math.min(textWidth, 1) * 0,
	);
	ctx.restore();
}

export const statisticTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.statistic",
		name: "Statistic",
		category: "Data",
		description: "Counting stat with pulsing halo and caption.",
		defaultDurationSec: 4,
	},
	definition: {
		id: "rhymx.statistic",
		name: "Statistic",
		keywords: ["statistic", "number", "percent", "data", "count"],
		params: STATISTIC_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderStatistic,
	} satisfies GraphicDefinition,
};
