import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import {
	entranceProgress,
	exitFactor,
	clamp01,
} from "../animation";
import {
	accent,
	setFont,
	textParam,
	withAlpha,
	TEXT_PRIMARY,
	wrapLines,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface HeroParams {
	title: string;
	subtitle: string;
	accentColor: string;
}

const HERO_PARAMS: ParamDefinition<keyof HeroParams & string>[] = [
	{ key: "title", label: "Title", type: "text", default: "Big ideas, told simply" },
	{ key: "subtitle", label: "Subtitle", type: "text", default: "A short documentary film" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#22d3ee" },
];

function renderHero({ ctx, params, width, height, localTime = 0, durationSec = 4 }: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const enter = entranceProgress({ localTime });
	const exit = exitFactor({ localTime, durationSec });
	const title = textParam({ params, key: "title", fallback: "Title" });
	const subtitle = textParam({ params, key: "subtitle" });
	const color = accent({ params });

	ctx.save();
	ctx.globalAlpha = exit;

	const barHeight = Math.round(height * 0.008) * enter;
	ctx.fillStyle = color;
	ctx.fillRect(width * 0.14, height * 0.42 - 40 * (1 - enter), (width * 0.12) * enter, barHeight);

	setFont({ ctx, size: height * 0.11, weight: 800 });
	ctx.fillStyle = TEXT_PRIMARY;
	ctx.globalAlpha = exit * enter;
	const lines = wrapLines({ ctx, text: title, maxWidth: width * 0.72 });
	lines.forEach((line, index) => {
		ctx.fillText(line, width * 0.14 + 60 * (1 - enter), height * 0.5 + index * height * 0.13);
	});

	if (subtitle) {
		setFont({ ctx, size: height * 0.042, weight: 500 });
		ctx.fillStyle = withAlpha({ hex: color, alpha: 0.95 });
		ctx.globalAlpha = exit * clamp01({ value: enter - 0.25 });
		ctx.fillText(subtitle, width * 0.14 + 80 * (1 - enter), height * 0.5 + lines.length * height * 0.13 + 18);
	}
	ctx.restore();
}

export const heroTitleTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.hero-title",
		name: "Hero Title",
		category: "Titles",
		description: "Full-frame opening title with accent underline wipe.",
		defaultDurationSec: 4,
	},
	definition: {
		id: "rhymx.hero-title",
		name: "Hero Title",
		keywords: ["hero", "title", "intro", "opener"],
		params: HERO_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderHero,
	} satisfies GraphicDefinition,
};
