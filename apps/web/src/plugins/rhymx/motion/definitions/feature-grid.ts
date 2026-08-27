import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { exitFactor, staggeredProgress, easeOutCubic } from "../animation";
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

interface FeatureGridParams {
	item1: string;
	item2: string;
	item3: string;
	item4: string;
	title: string;
	accentColor: string;
}

const FEATURE_GRID_PARAMS: ParamDefinition<keyof FeatureGridParams & string>[] =
	[
		{ key: "title", label: "Title", type: "text", default: "Why it works" },
		{ key: "item1", label: "Item 1", type: "text", default: "Fast" },
		{ key: "item2", label: "Item 2", type: "text", default: "Simple" },
		{ key: "item3", label: "Item 3", type: "text", default: "Affordable" },
		{ key: "item4", label: "Item 4", type: "text", default: "Yours" },
		{ key: "accentColor", label: "Accent", type: "color", default: "#2dd4bf" },
	];

function renderFeatureGrid({
	ctx,
	params,
	width,
	height,
	localTime = 0,
	durationSec = 5,
}: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const color = accent({ params });
	const exit = exitFactor({ localTime, durationSec });
	const items = [1, 2, 3, 4]
		.map((index) => textParam({ params, key: `item${index}` }))
		.filter(Boolean);

	ctx.save();
	ctx.globalAlpha = exit;

	if (textParam({ params, key: "title" })) {
		const titleEnter = easeOutCubic({ t: localTime / 0.6 });
		setFont({ ctx, size: height * 0.055, weight: 800 });
		ctx.fillStyle = TEXT_PRIMARY;
		ctx.globalAlpha = exit * titleEnter;
		ctx.textAlign = "center";
		ctx.fillText(textParam({ params, key: "title" }), width / 2, height * 0.24);
	}

	items.forEach((item, index) => {
		const enter = staggeredProgress({ localTime, index: index + 0.5 });
		if (enter <= 0) {
			return;
		}
		const col = index % 2;
		const row = Math.floor(index / 2);
		const cellWidth = width * 0.3;
		const cellHeight = height * 0.2;
		const cellX =
			width / 2 - cellWidth - width * 0.02 + col * (cellWidth + width * 0.04);
		const cellY = height * 0.32 + row * (cellHeight + height * 0.04);

		ctx.globalAlpha = exit * enter;
		setFont({ ctx, size: height * 0.07, weight: 800 });
		ctx.fillStyle = withAlpha({ hex: color, alpha: 0.9 });
		ctx.fillText(
			String(index + 1).padStart(2, "0"),
			cellX,
			cellY + cellHeight * 0.4,
		);

		setFont({ ctx, size: height * 0.048, weight: 700 });
		ctx.fillStyle = TEXT_PRIMARY;
		const lines = wrapLines({ ctx, text: item, maxWidth: cellWidth * 0.8 });
		lines.forEach((line, lineIndex) => {
			ctx.fillText(line, cellX, cellY + cellHeight * (0.75 + lineIndex * 0.35));
		});
	});

	ctx.textAlign = "left";
	ctx.restore();
}

export const featureGridTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.feature-grid",
		name: "Feature Grid",
		category: "Lists",
		description: "Numbered two-by-two grid with stagger-in cells.",
		defaultDurationSec: 5,
	},
	definition: {
		id: "rhymx.feature-grid",
		name: "Feature Grid",
		keywords: ["features", "grid", "benefits"],
		params: FEATURE_GRID_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderFeatureGrid,
	} satisfies GraphicDefinition,
};
