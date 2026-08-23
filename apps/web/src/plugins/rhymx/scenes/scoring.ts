import type { StockCandidate, StockProviderId } from "../types";

export interface ScoreContext {
	/** Words from the search query, lowercased. */
	queryTerms: string[];
	/** Target scene duration in seconds (for duration-fit scoring). */
	targetDurationSec: number;
	/** Provider usage counts so far, for diversity bonus. */
	providerUsage?: Map<StockProviderId, number>;
}

/**
 * Candidate scorer (ported from Rhymx `scoreCandidate`):
 * relevance ×35 + video preference +15 + landscape +15 + resolution +
 * duration fit + provider diversity.
 */
export function scoreCandidate({
	candidate,
	context,
}: {
	candidate: StockCandidate;
	context: ScoreContext;
}): number {
	let score = 0;

	const haystack = [
		candidate.landingUrl ?? "",
		candidate.creator ?? "",
	].join(" ").toLowerCase();
	const matches = context.queryTerms.filter((term) =>
		haystack.includes(term),
	).length;
	score += Math.min(35, matches * 8);

	if (candidate.kind === "video") {
		score += 15;
	}

	const width = candidate.width ?? 0;
	const height = candidate.height ?? 0;
	if (width > height && width >= 1280) {
		score += 15;
	}
	if (width >= 1920) {
		score += 5;
	} else if (width >= 1280) {
		score += 3;
	}

	if (candidate.durationSec != null && context.targetDurationSec > 0) {
		const ratio = candidate.durationSec / context.targetDurationSec;
		if (ratio >= 1 && ratio <= 3) {
			score += 12;
		} else if (ratio > 0.5 && ratio < 6) {
			score += 6;
		}
	}

	const usage = context.providerUsage?.get(candidate.provider) ?? 0;
	score += Math.max(0, 5 - usage);

	return score;
}

/** Sorts candidates by descending score and returns the top N. */
export function rankCandidates({
	candidates,
	context,
	limit = 4,
}: {
	candidates: StockCandidate[];
	context: ScoreContext;
	limit?: number;
}): StockCandidate[] {
	const providerUsage = context.providerUsage ?? new Map<StockProviderId, number>();
	const scored = [...candidates].sort(
		(a, b) =>
			scoreCandidate({ candidate: b, context }) -
			scoreCandidate({ candidate: a, context }),
	);

	const seenProviders = new Map(providerUsage);
	const picked: StockCandidate[] = [];
	for (const candidate of scored) {
		if (picked.length >= limit) {
			break;
		}
		picked.push(candidate);
		seenProviders.set(candidate.provider, (seenProviders.get(candidate.provider) ?? 0) + 1);
	}
	return picked;
}

export type MatchConfidence = "strong" | "review" | "none";

export function confidenceFromTopScore(score: number): MatchConfidence {
	if (score >= 60) {
		return "strong";
	}
	if (score > 0) {
		return "review";
	}
	return "none";
}
