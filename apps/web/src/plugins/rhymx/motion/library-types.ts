import type { GraphicDefinition } from "@/graphics";

export interface MotionTemplateMeta {
	id: string;
	name: string;
	category:
		| "Titles"
		| "Data"
		| "Editorial"
		| "Lists"
		| "Calls to action"
		| "Advanced motion";
	description: string;
	defaultDurationSec: number;
}

export interface MotionTemplate {
	meta: MotionTemplateMeta;
	definition: GraphicDefinition;
}
