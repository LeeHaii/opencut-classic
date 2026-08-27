import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { clamp01, easeOutBack, exitFactor } from "../animation";
import { accent, setFont, textParam, TEXT_PRIMARY } from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;
const WORD_STAGGER_SEC = 0.22;

interface KineticTitleParams {
	title: string;
	accentColor: string;
}

const KINETIC_PARAMS: ParamDefinition<keyof KineticTitleParams & string>[] = [
	{ key: "title", label: "Title", type: "text", default: "Move with purpose" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#facc15" },
];

function renderKineticTitle({
	ctx,
	params,
	width,
	height,
	localTime = 0,
	durationSec = 3,
}: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const color = accent({ params });
	const exit = exitFactor({ localTime, durationSec });
	const words = textParam({ params, key: "title" })
		.split(/\s+/)
		.filter(Boolean);

	setFont({ ctx, size: height * 0.13, weight: 800 });
	ctx.textAlign = "center";
	const spaceWidth = ctx.measureText(" ").width;
	const wordWidths = words.map((word) => ctx.measureText(word).width);
	const totalWidth =
		wordWidths.reduce((sum, w) => sum + w, 0) +
		Math.max(0, words.length - 1) * spaceWidth;

	ctx.save();
	ctx.globalAlpha = exit;
	let cursorX = width / 2 - totalWidth / 2;
	words.forEach((word, index) => {
		const enter = easeOutBack({
			t: (localTime - index * WORD_STAGGER_SEC) / 0.55,
		});
		if (enter > 0) {
			ctx.save();
			ctx.translate(cursorX + wordWidths[index] / 2, height / 2);
			ctx.scale(clamp01({ value: enter }), clamp01({ value: enter }));
			ctx.globalAlpha = exit * clamp01({ value: enter * 2 });
			if (index % 2 === 1) {
				ctx.fillStyle = color;
			} else {
				ctx.fillStyle = TEXT_PRIMARY;
			}
			ctx.fillText(word, 0, height * 0.045);
			ctx.restore();
		}
		cursorX += wordWidths[index] + spaceWidth;
	});
	ctx.restore();
}

export const kineticTitleTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.kinetic-title",
		name: "Kinetic Title",
		category: "Advanced motion",
		description: "Word-by-word popping title cascade.",
		defaultDurationSec: 3,
	},
	definition: {
		id: "rhymx.kinetic-title",
		name: "Kinetic Title",
		keywords: ["kinetic", "typography", "words", "title"],
		params: KINETIC_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderKineticTitle,
	} satisfies GraphicDefinition,
};
