import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { exitFactor, staggeredProgress, clamp01 } from "../animation";
import { accent, setFont, textParam, TEXT_PRIMARY } from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface ChecklistParams {
	items: string;
	title: string;
	accentColor: string;
}

const CHECKLIST_PARAMS: ParamDefinition<keyof ChecklistParams & string>[] = [
	{
		key: "title",
		label: "Title",
		type: "text",
		default: "What you will learn",
	},
	{
		key: "items",
		label: "Items (one per line)",
		type: "text",
		default: "Plan the story\nShoot with any camera\nEdit in minutes",
	},
	{ key: "accentColor", label: "Accent", type: "color", default: "#34d399" },
];

function renderChecklist({
	ctx,
	params,
	width,
	height,
	localTime = 0,
	durationSec = 5,
}: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const color = accent({ params });
	const title = textParam({ params, key: "title" });
	const items = textParam({ params, key: "items" })
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const exit = exitFactor({ localTime, durationSec });

	ctx.save();
	ctx.globalAlpha = exit;

	let y = height * 0.24;
	if (title) {
		setFont({ ctx, size: height * 0.055, weight: 800 });
		ctx.fillStyle = TEXT_PRIMARY;
		ctx.fillText(title, width * 0.16, y);
		y += height * 0.1;
	}

	setFont({ ctx, size: height * 0.042, weight: 600 });
	items.forEach((item, index) => {
		const enter = staggeredProgress({
			localTime,
			index: index + 1,
			staggerSec: 0.18,
		});
		if (enter <= 0) {
			return;
		}
		const rowY = y + index * height * 0.095;
		ctx.globalAlpha = exit * enter;

		ctx.strokeStyle = color;
		ctx.lineWidth = height * 0.008;
		ctx.lineCap = "round";
		ctx.beginPath();
		ctx.arc(
			width * 0.17,
			rowY - height * 0.014,
			height * 0.022,
			0,
			Math.PI * 2,
		);
		ctx.stroke();

		const checkProgress = staggeredProgress({
			localTime,
			index: index + 1,
			staggerSec: 0.18,
			entranceSec: 0.35,
		});
		ctx.beginPath();
		ctx.moveTo(width * 0.17 - height * 0.01, rowY - height * 0.014);
		ctx.lineTo(width * 0.17 - height * 0.002, rowY - height * 0.004);
		ctx.lineTo(width * 0.17 + height * 0.014, rowY - height * 0.026);
		ctx.globalAlpha = exit * clamp01({ value: checkProgress * 1.5 });
		ctx.stroke();
		ctx.globalAlpha = exit * enter;
		ctx.fillStyle = TEXT_PRIMARY;
		ctx.fillText(item, width * 0.21, rowY);
	});
	ctx.restore();
}

export const checklistTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.checklist",
		name: "Checklist",
		category: "Lists",
		description: "Staggered rows with animated checkmarks.",
		defaultDurationSec: 5,
	},
	definition: {
		id: "rhymx.checklist",
		name: "Checklist",
		keywords: ["checklist", "steps", "todo", "list"],
		params: CHECKLIST_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderChecklist,
	} satisfies GraphicDefinition,
};
