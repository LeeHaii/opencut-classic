import type { CaptionMode, PlanScene, TimedWord } from "../types";
import type { SubtitleCue } from "@/subtitles/types";

function sceneWords(scene: PlanScene): TimedWord[] {
	if (scene.words && scene.words.length > 0) {
		return scene.words;
	}
	const tokens = scene.transcriptText.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return [];
	}
	const per = Math.max(0.08, scene.durationSec / tokens.length);
	return tokens.map((token, index) => ({
		id: `${scene.id}-syn-${index}`,
		text: token,
		startTimeSec: scene.startTimeSec + index * per,
		endTimeSec: scene.startTimeSec + (index + 1) * per,
	}));
}

/** Splits a word run into cue-sized chunks of `size` words. */
function chunkedCues({
	words,
	size,
}: {
	words: TimedWord[];
	size: number;
}): SubtitleCue[] {
	const cues: SubtitleCue[] = [];
	for (let index = 0; index < words.length; index += size) {
		const chunk = words.slice(index, index + size);
		if (chunk.length === 0) {
			continue;
		}
		cues.push({
			text: chunk.map((word) => word.text).join(" "),
			startTime: chunk[0].startTimeSec,
			duration: Math.max(0.2, chunk[chunk.length - 1].endTimeSec - chunk[0].startTimeSec),
		});
	}
	return cues;
}

/**
 * Builds caption cues from planned scenes in the requested mode.
 * - sentence: one cue per scene
 * - phrase: 3-word chunks (word timings or synthetic evenly-spread timings)
 * - word: one cue per word
 * - keywords: one cue per scene containing only emphasized (≥7 char) words
 */
export function buildCaptionCues({
	scenes,
	mode,
	wordsPerPhrase = 3,
}: {
	scenes: PlanScene[];
	mode: CaptionMode;
	wordsPerPhrase?: number;
}): SubtitleCue[] {
	switch (mode) {
		case "sentence":
			return scenes
				.filter((scene) => scene.transcriptText.trim().length > 0)
				.map((scene) => ({
					text: scene.transcriptText.trim(),
					startTime: scene.startTimeSec,
					duration: scene.durationSec,
				}));
		case "phrase":
			return scenes.flatMap((scene) =>
				chunkedCues({ words: sceneWords(scene), size: wordsPerPhrase }),
			);
		case "word":
			return sceneWordsAll(scenes).map((word) => ({
				text: word.text,
				startTime: word.startTimeSec,
				duration: Math.max(0.15, word.endTimeSec - word.startTimeSec),
			}));
		case "keywords":
			return scenes.flatMap((scene) => {
				const emphasized = sceneWords(scene).filter(
					(word) => word.text.replace(/[^a-zA-Z0-9]/g, "").length >= 7,
				);
				if (emphasized.length === 0) {
					return [];
				}
				return [
					{
						text: emphasized.map((word) => word.text.toUpperCase()).join(" · "),
						startTime: scene.startTimeSec,
						duration: scene.durationSec,
					} satisfies SubtitleCue,
				];
			});
	}
}

function sceneWordsAll(scenes: PlanScene[]): TimedWord[] {
	return scenes.flatMap((scene) => sceneWords(scene));
}
