export type RhymxTreatment = "media" | "motion";

export interface TimedWord {
	id: string;
	text: string;
	startTimeSec: number;
	endTimeSec: number;
}

export interface SceneDraft {
	id: string;
	sceneNumber: number;
	startTimeSec: number;
	endTimeSec: number;
	durationSec: number;
	transcriptText: string;
	words?: TimedWord[];
}

export type StockProviderId =
	| "pexels"
	| "pixabay"
	| "wikimedia"
	| "archive"
	| "nasa";

export interface StockCandidate {
	id: string;
	provider: StockProviderId;
	kind: "video" | "image";
	sourceUrl: string;
	previewUrl?: string;
	thumbnailUrl?: string;
	width?: number;
	height?: number;
	durationSec?: number;
	creator?: string;
	creatorUrl?: string;
	landingUrl?: string;
	licenseName: string;
	licenseUrl?: string;
	score?: number;
}

export interface PlannedScene {
	id: string;
	visualIntent: string;
	keywords: string[];
	treatment: RhymxTreatment;
}

export type MatchStatus =
	| "idle"
	| "searching"
	| "ready"
	| "failed"
	| "skipped";

export interface PlanScene extends SceneDraft, PlannedScene {
	templateId?: string;
	candidates: StockCandidate[];
	selectedCandidateId: string | null;
	matchStatus: MatchStatus;
}

export type CaptionMode = "sentence" | "phrase" | "word" | "keywords";

export type RhymxProviderKey = "groq" | "pexels" | "pixabay";

export interface RhymxApiKeys {
	groq: string;
	pexels: string;
	pixabay: string;
}
