import type { ParamDefinition } from "@/params";
import type { GraphicDefinition, GraphicRenderContext } from "@/graphics";
import { exitFactor, clamp01, easeOutCubic } from "../animation";
import {
	accent,
	drawGlassCard,
	setFont,
	textParam,
	withAlpha,
	TEXT_PRIMARY,
	wrapLines,
} from "../canvas";
import type { MotionTemplate } from "../library-types";

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 900;

interface ProductCardParams {
	name: string;
	price: string;
	tagline: string;
	accentColor: string;
}

const PRODUCT_PARAMS: ParamDefinition<keyof ProductCardParams & string>[] = [
	{ key: "name", label: "Name", type: "text", default: "Aurora Lamp" },
	{ key: "price", label: "Price", type: "text", default: "$129" },
	{ key: "tagline", label: "Tagline", type: "text", default: "Sunset light on demand" },
	{ key: "accentColor", label: "Accent", type: "color", default: "#fb923c" },
];

function renderProductCard({ ctx, params, width, height, localTime = 0, durationSec = 4 }: GraphicRenderContext): void {
	ctx.clearRect(0, 0, width, height);
	const slide = easeOutCubic({ t: localTime / 0.7 });
	const pricePop = clamp01({ value: (localTime - 0.4) * 3 });
	const exit = exitFactor({ localTime, durationSec });
	const color = accent({ params });

	ctx.save();
	ctx.globalAlpha = exit;

	const cardWidth = width * 0.36;
	const cardHeight = height * 0.56;
	const cardX = width * 0.1 + 90 * (1 - slide);
	const cardY = height * 0.22 - 30 * (1 - slide);
	drawGlassCard({ ctx, x: cardX, y: cardY, width: cardWidth, height: cardHeight, radius: 30 });

	setFont({ ctx, size: height * 0.055, weight: 800 });
	ctx.fillStyle = TEXT_PRIMARY;
	ctx.globalAlpha = exit * clamp01({ value: slide });
	const lines = wrapLines({
		ctx,
		text: textParam({ params, key: "name" }),
		maxWidth: cardWidth - 80,
	});
	lines.forEach((line, index) => {
		ctx.fillText(line, cardX + 40, cardY + cardHeight * 0.24 + index * height * 0.07);
	});

	if (pricePop > 0) {
		const chipWidth = cardWidth * 0.34 * Math.min(1, pricePop);
		const chipX = cardX + 40;
		const chipY = cardY + cardHeight - height * 0.14;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.roundRect(chipX, chipY, chipWidth, height * 0.075, height * 0.0375);
		ctx.fill();
		setFont({ ctx, size: height * 0.042, weight: 800 });
		ctx.fillStyle = "#0f172a";
		ctx.fillText(textParam({ params, key: "price" }), chipX + 24, chipY + height * 0.05);
	}

	if (textParam({ params, key: "tagline" })) {
		setFont({ ctx, size: height * 0.032, weight: 500 });
		ctx.fillStyle = withAlpha({ hex: color, alpha: 0.95 });
		ctx.fillText(
			textParam({ params, key: "tagline" }),
			cardX + 40,
			cardY + cardHeight * 0.42,
		);
	}
	ctx.restore();
}

export const productCardTemplate: MotionTemplate = {
	meta: {
		id: "rhymx.product-card",
		name: "Product Card",
		category: "Advanced motion",
		description: "Sliding glass product showcase with price chip.",
		defaultDurationSec: 4,
	},
	definition: {
		id: "rhymx.product-card",
		name: "Product Card",
		keywords: ["product", "shop", "price", "showcase"],
		params: PRODUCT_PARAMS,
		animated: true,
		sourceWidth: SOURCE_WIDTH,
		sourceHeight: SOURCE_HEIGHT,
		render: renderProductCard,
	} satisfies GraphicDefinition,
};
