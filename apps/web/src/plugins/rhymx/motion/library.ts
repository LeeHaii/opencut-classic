import { graphicsRegistry } from "@/graphics";
import { checklistTemplate } from "./definitions/checklist";
import { chapterCardTemplate } from "./definitions/chapter-card";
import { countdownTemplate } from "./definitions/countdown";
import { endCardTemplate } from "./definitions/end-card";
import { featureGridTemplate } from "./definitions/feature-grid";
import { heroTitleTemplate } from "./definitions/hero-title";
import { kineticTitleTemplate } from "./definitions/kinetic-title";
import { lowerThirdTemplate } from "./definitions/lower-third";
import { productCardTemplate } from "./definitions/product-card";
import { progressBarTemplate } from "./definitions/progress-bar";
import { quoteTemplate } from "./definitions/quote";
import { socialCalloutTemplate } from "./definitions/social-callout";
import { splitComparisonTemplate } from "./definitions/split-comparison";
import { statisticTemplate } from "./definitions/statistic";
import type { MotionTemplate, MotionTemplateMeta } from "./library-types";

export const RHYMX_MOTION_TEMPLATES: MotionTemplate[] = [
	heroTitleTemplate,
	statisticTemplate,
	quoteTemplate,
	progressBarTemplate,
	lowerThirdTemplate,
	splitComparisonTemplate,
	checklistTemplate,
	countdownTemplate,
	chapterCardTemplate,
	socialCalloutTemplate,
	featureGridTemplate,
	kineticTitleTemplate,
	productCardTemplate,
	endCardTemplate,
];

export const RHYMX_TEMPLATE_PREFIX = "rhymx.";

let registered = false;

export function ensureRhymxMotionTemplates(): void {
	if (registered) {
		return;
	}
	for (const template of RHYMX_MOTION_TEMPLATES) {
		if (!graphicsRegistry.has(template.definition.id)) {
			graphicsRegistry.register({
				key: template.definition.id,
				definition: template.definition,
			});
		}
	}
	registered = true;
}

export function listRhymxTemplates(): MotionTemplateMeta[] {
	ensureRhymxMotionTemplates();
	return RHYMX_MOTION_TEMPLATES.map((template) => template.meta);
}

export function getRhymxTemplate({
	templateId,
}: {
	templateId: string;
}): MotionTemplate | null {
	ensureRhymxMotionTemplates();
	return (
		RHYMX_MOTION_TEMPLATES.find(
			(template) => template.meta.id === templateId,
		) ?? null
	);
}

/** Heuristic mapping from a planned scene's intent/keywords to a template. */
export function suggestTemplateForScene({
	visualIntent,
	keywords,
}: {
	visualIntent: string;
	keywords: string[];
}): string {
	const haystack = [visualIntent, ...keywords].join(" ").toLowerCase();
	const rules: Array<{ match: string[]; id: string }> = [
		{ match: ["percent", "%", "statistic", "stat", "number"], id: "rhymx.statistic" },
		{ match: ["quote", "citation", "said"], id: "rhymx.quote" },
		{ match: ["progress", "growth", "complete"], id: "rhymx.progress-bar" },
		{ match: ["compare", "versus", "vs", "before", "after"], id: "rhymx.split-comparison" },
		{ match: ["checklist", "steps", "list"], id: "rhymx.checklist" },
		{ match: ["countdown", "timer"], id: "rhymx.countdown" },
		{ match: ["chapter", "part two", "section"], id: "rhymx.chapter-card" },
		{ match: ["subscribe", "follow", "call to action", "cta"], id: "rhymx.social-callout" },
		{ match: ["features", "benefits", "grid"], id: "rhymx.feature-grid" },
		{ match: ["product", "price", "shop"], id: "rhymx.product-card" },
		{ match: ["outro", "end card", "thanks"], id: "rhymx.end-card" },
		{ match: ["kinetic", "typography", "energetic title"], id: "rhymx.kinetic-title" },
	];
	for (const rule of rules) {
		if (rule.match.some((needle) => haystack.includes(needle))) {
			return rule.id;
		}
	}
	return "rhymx.hero-title";
}
