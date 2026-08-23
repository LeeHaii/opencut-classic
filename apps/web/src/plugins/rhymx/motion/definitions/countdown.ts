import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { entranceProgress, exitFactor, clamp01 } from "../animation";
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

interface CountdownParams {
	seconds: number;
	label: string;
	accentColor: string;
}

const COUNTDOWN_PARAMS: ParamDefinition<keyof CountdownParams & string>[] = [
	{ key: "seconds", label: "Seconds", type: "number", default: 5, min: 1, max: 60, step: 1 },
	{ key: "label", label: "Label", type: "text", default: "Get ready" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#f472b6" },
];

function renderCountdown({ ctx, params, width, height, localTime = 0, durationSec = 5 }: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const enter = entranceProgress({ localTime });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });
	const total = Math.max(1, numberParam({ params, key: "seconds", fallback: 5 }));

	const remaining = Math.max(0, total - localTime);
	const numeral = String(Math.ceil(remaining));
	const fraction = remaining - Math.floor(remaining);

	ctx.save();
	ctx.globalAlpha = exit;

	const centerX = width / 2;
	const centerY = height * 0.46;
	const radius = height * 0.26 * enter;

	ctx.strokeStyle = withAlpha({ hex: "#94a3b8", alpha: 0.25 });
	ctx.lineWidth = height * 0.02;
	ctx.beginPath();
	ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
	ctx.stroke();

	ctx.strokeStyle = color;
	ctx.beginPath();
	ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
	ctx.stroke();

	const popScale = clamp01({ value: (1 - fraction) * 1.6 });
	setFont({ ctx, size: height * 0.16 * (1 + 0.12 * (1 - popScale)), weight: 800 });
	ctx.fillStyle = TEXT_PRIMARY;
	ctx.textAlign = "center";
	ctx.globalAlpha = exit * clamp01({ value: fraction * 3 });
	ctx.fillText(numeral, centerX, centerY + height * 0.055);
	ctx.globalAlpha = exit;

	if (textParam({ params, key: "label" })) {
		setFont({ ctx, size: height * 0.04, weight: 600 });
		ctx.fillStyle = withAlpha({ hex: color, alpha: 0.95 });
		ctx.fillText(textParam({ params, key: "label" }), centerX, centerY + radius + height * 0.08);
	}
	ctx.textAlign = "left";
	ctx.restore();
}

export const countdownTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.countdown",
		name: "Countdown",
		category: "Data",
		description: "Pulsing ring countdown with numeral swaps.",
		defaultDurationSec: 5,
	},
	definition: {
		id: "rhymx.countdown",
		name: "Countdown",
		keywords: ["countdown", "timer", "clock"],
		params: COUNTDOWN_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderCountdown,
	} satisfies GraphicDefinition,
};
