import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { entranceProgress, exitFactor, clamp01 } from "../animation";
import {
	accent,
	numberParam,
	roundRectPath,
	setFont,
	textParam,
	withAlpha,
	TEXT_PRIMARY,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface ProgressBarParams {
	percent: number;
	label: string;
	accentColor: string;
}

const PROGRESS_PARAMS: ParamDefinition<keyof ProgressBarParams & string>[] = [
	{ key: "percent", label: "Percent", type: "number", default: 72, min: 0, max: 100, step: 1 },
	{ key: "label", label: "Label", type: "text", default: "Project complete" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#34d399" },
];

function renderProgressBar({ ctx, params, width, height, localTime = 0, durationSec = 4 }: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const enter = entranceProgress({ localTime });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });
	const percent = numberParam({ params, key: "percent", fallback: 0 });

	ctx.save();
	ctx.globalAlpha = exit;

	setFont({ ctx, size: height * 0.055, weight: 700 });
	ctx.fillStyle = TEXT_PRIMARY;
	ctx.fillText(textParam({ params, key: "label" }), width * 0.2, height * 0.42);

	const shown = Math.round(percent * enter);
	setFont({ ctx, size: height * 0.07, weight: 800 });
	ctx.fillStyle = color;
	const labelWidth = ctx.measureText(textParam({ params, key: "label" })).width;
	ctx.fillText(`${shown}%`, width * 0.2 + labelWidth + 40, height * 0.42);

	const barY = height * 0.48;
	const barWidth = width * 0.6;
	const barHeight = height * 0.035;
	ctx.fillStyle = withAlpha({ hex: "#94a3b8", alpha: 0.25 });
	ctx.fill(roundRectPath({ x: width * 0.2, y: barY, width: barWidth, height: barHeight, radius: barHeight / 2 }));
	ctx.fillStyle = color;
	const fillRatio = clamp01({ value: (percent / 100) * enter });
	ctx.fill(
		roundRectPath({
			x: width * 0.2,
			y: barY,
			width: Math.max(barHeight, barWidth * fillRatio),
			height: barHeight,
			radius: barHeight / 2,
		}),
	);
	ctx.restore();
}

export const progressBarTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.progress-bar",
		name: "Progress Bar",
		category: "Data",
		description: "Animated fill bar with counting percentage.",
		defaultDurationSec: 4,
	},
	definition: {
		id: "rhymx.progress-bar",
		name: "Progress Bar",
		keywords: ["progress", "bar", "percent", "loading"],
		params: PROGRESS_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderProgressBar,
	} satisfies GraphicDefinition,
};
