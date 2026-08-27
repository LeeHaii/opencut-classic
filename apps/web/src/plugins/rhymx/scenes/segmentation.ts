import type { SceneDraft, TimedWord } from "../types";

const MIN_SCENE_SEC = 5;
const MIN_SENTENCE_SCENE_SEC = 2.5;
const SENTENCE_ENDINGS = /[.!?]["')\]]?$/;

let idCounter = 0;

function nextId(): string {
	idCounter += 1;
	return `rhymx-scene-${Date.now().toString(36)}-${idCounter}`;
}

interface TranscriptWordInput {
	text: string;
	startSec: number;
	endSec: number;
}

/**
 * Groups timed words into scenes (ported from Rhymx `scenesFromTranscript`):
 * a new scene starts when the current span reaches MIN_SCENE_SEC, or reaches
 * MIN_SENTENCE_SCENE_SEC and the word ends a sentence.
 */
export function segmentWords({
	words,
}: {
	words: TranscriptWordInput[];
}): SceneDraft[] {
	const timedWords: TimedWord[] = words.map((word) => ({
		id: nextId(),
		text: word.text.trim(),
		startTimeSec: word.startSec,
		endTimeSec: word.endSec,
	}));
	const usable = timedWords.filter((word) => word.text.length > 0);
	if (usable.length === 0) {
		return [];
	}

	const scenes: SceneDraft[] = [];
	let currentWords: TimedWord[] = [];

	const flush = () => {
		if (currentWords.length === 0) {
			return;
		}
		const startTimeSec = currentWords[0].startTimeSec;
		const endTimeSec = currentWords[currentWords.length - 1].endTimeSec;
		scenes.push({
			id: nextId(),
			sceneNumber: scenes.length + 1,
			startTimeSec,
			endTimeSec,
			durationSec: Math.max(0.2, endTimeSec - startTimeSec),
			transcriptText: currentWords.map((word) => word.text).join(" "),
			words: [...currentWords],
		});
		currentWords = [];
	};

	for (const word of usable) {
		currentWords.push(word);
		const span =
			word.endTimeSec - (currentWords[0]?.startTimeSec ?? word.startTimeSec);
		if (
			span >= MIN_SCENE_SEC ||
			(span >= MIN_SENTENCE_SCENE_SEC && SENTENCE_ENDINGS.test(word.text))
		) {
			flush();
		}
	}
	flush();

	return scenes;
}

interface TranscriptSegmentInput {
	text: string;
	start: number;
	end: number;
}

/**
 * Fallback segmentation when only segment-level timings are available
 * (e.g. OpenCut's on-device transcription): merges short segments until a
 * sentence-ending segment or the 5s budget is hit.
 */
export function segmentTranscriptSegments({
	segments,
}: {
	segments: TranscriptSegmentInput[];
}): SceneDraft[] {
	if (segments.length === 0) {
		return [];
	}

	const scenes: SceneDraft[] = [];
	let bufferText = "";
	let bufferStart = segments[0].start;

	const flush = (endSec: number) => {
		const text = bufferText.trim();
		if (!text) {
			bufferStart = endSec;
			return;
		}
		scenes.push({
			id: nextId(),
			sceneNumber: scenes.length + 1,
			startTimeSec: bufferStart,
			endTimeSec: endSec,
			durationSec: Math.max(0.2, endSec - bufferStart),
			transcriptText: text,
		});
		bufferText = "";
		bufferStart = endSec;
	};

	for (const segment of segments) {
		const spanEndsSentence = SENTENCE_ENDINGS.test(segment.text.trim());
		bufferText += `${bufferText ? " " : ""}${segment.text.trim()}`;
		const span = segment.end - bufferStart;
		if (
			span >= MIN_SCENE_SEC ||
			(span >= MIN_SENTENCE_SCENE_SEC && spanEndsSentence)
		) {
			flush(segment.end);
		}
	}
	flush(segments[segments.length - 1].end);

	return scenes;
}
