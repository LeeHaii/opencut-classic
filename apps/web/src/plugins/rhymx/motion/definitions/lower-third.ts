import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import {
	entranceProgress,
	exitFactor,
	clamp01,
	easeOutCubic,
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

interface LowerThirdParams {
	name: string;
	role: string;
	accentColor: string;
}

const LOWER_THIRD_PARAMS: ParamDefinition<keyof LowerThirdParams & string>[] = [
	{ key: "name", label: "Name", type: "text", default: "Dr. Maya Chen" },
	{ key: "role", label: "Role", type: "text", default: "Climate Scientist" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#38bdf8" },
];

function renderLowerThird({
	ctx,
	params,
	width,
	height,
	localTime = 0,
	durationSec = 4,
}: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const slide = easeOutCubic({ t: localTime / 0.6 });
	const enter = entranceProgress({ localTime });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });
	const name = textParam({ params, key: "name" });
	const role = textParam({ params, key: "role" });

	ctx.save();
	ctx.globalAlpha = exit;

	const barWidth = width * 0.34;
	const barHeight = height * 0.14;
	const barX = width * 0.06 - barWidth * (1 - slide);
	const barY = height * 0.74;
	ctx.fillStyle = withAlpha({ hex: color, alpha: 0.9 });
	ctx.fill(
		roundRectPath({
			x: barX,
			y: barY,
			width: 8 * enter + 2,
			height: barHeight,
			radius: 4,
		}),
	);

	ctx.fillStyle = withAlpha({ hex: "#0f172a", alpha: 0.78 });
	ctx.fill(
		roundRectPath({
			x: barX + 18,
			y: barY,
			width: barWidth - 24,
			height: barHeight,
			radius: 12,
		}),
	);

	setFont({ ctx, size: height * 0.042, weight: 800 });
	ctx.fillStyle = TEXT_PRIMARY;
	ctx.globalAlpha = exit * clamp01({ value: slide });
	ctx.fillText(name, barX + 44, barY + barHeight * 0.42);

	if (role) {
		setFont({ ctx, size: height * 0.03, weight: 600 });
		ctx.fillStyle = color;
		ctx.fillText(role, barX + 44, barY + barHeight * 0.76);
	}
	ctx.restore();
}

export const lowerThirdTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.lower-third",
		name: "Lower Third",
		category: "Titles",
		description: "Sliding name bar for speakers and locations.",
		defaultDurationSec: 4,
	},
	definition: {
		id: "rhymx.lower-third",
		name: "Lower Third",
		keywords: ["lower third", "name tag", "speaker", "caption bar"],
		params: LOWER_THIRD_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderLowerThird,
	} satisfies GraphicDefinition,
};
