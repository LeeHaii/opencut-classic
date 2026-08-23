import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { entranceProgress, exitFactor, easeOutBack, clamp01, easeOutCubic } from "../animation";
import {
	accent,
	setFont,
	textParam,
	withAlpha,
	TEXT_PRIMARY,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface ChapterCardParams {
	number: string;
	title: string;
	accentColor: string;
}

const CHAPTER_PARAMS: ParamDefinition<keyof ChapterCardParams & string>[] = [
	{ key: "number", label: "Number", type: "text", default: "01" },
	{ key: "title", label: "Title", type: "text", default: "The Setup" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#818cf8" },
];

function renderChapterCard({ ctx, params, width, height, localTime = 0, durationSec = 4 }: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const numeralEnter = easeOutCubic({ t: localTime / 0.6 });
	const pop = easeOutBack({ t: (localTime - 0.15) / 0.6 });
	const titleEnter = entranceProgress({ localTime: localTime - 0.25 });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });

	ctx.save();
	ctx.globalAlpha = exit;
	ctx.fillStyle = withAlpha({ hex: color, alpha: 0.14 * numeralEnter });
	ctx.fillRect(0, 0, width * numeralEnter, height);

	const scale = clamp01({ value: pop });
	setFont({ ctx, size: height * 0.5 * (0.85 + 0.15 * scale), weight: 800 });
	ctx.fillStyle = withAlpha({ hex: color, alpha: 0.9 });
	ctx.fillText(textParam({ params, key: "number", fallback: "1" }), width * 0.12, height * 0.62);

	if (titleEnter > 0) {
		setFont({ ctx, size: height * 0.09, weight: 800 });
		ctx.fillStyle = TEXT_PRIMARY;
		ctx.globalAlpha = exit * titleEnter;
		ctx.fillText(
			textParam({ params, key: "title" }),
			width * 0.12 + width * 0.06 * (1 - titleEnter),
			height * 0.78,
		);
	}
	ctx.restore();
}

export const chapterCardTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.chapter-card",
		name: "Chapter Card",
		category: "Titles",
		description: "Giant chapter numeral with title reveal.",
		defaultDurationSec: 4,
	},
	definition: {
		id: "rhymx.chapter-card",
		name: "Chapter Card",
		keywords: ["chapter", "section", "part"],
		params: CHAPTER_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderChapterCard,
	} satisfies GraphicDefinition,
};
