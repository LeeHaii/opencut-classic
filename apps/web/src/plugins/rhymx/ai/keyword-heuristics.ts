const STOP_WORDS = new Set([
	"a","an","and","are","as","at","be","been","but","by","can","could","did",
	"do","does","for","from","had","has","have","he","her","here","hers","him",
	"his","how","i","if","in","into","is","it","its","just","like","me","more",
	"most","my","no","not","of","on","or","our","out","she","should","so","some",
	"than","that","the","their","them","then","there","these","they","this",
	"to","too","up","very","was","we","were","what","when","where","which",
	"while","who","why","will","with","would","you","your","yours","about",
	"also","because","been","being","over","only","really","actually",
]);

interface WordFrequency {
	word: string;
	count: number;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s'-]/g, " ")
		.split(/\s+/)
		.filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Heuristic keyword extraction (ported from Rhymx `searchKeywords`):
 * frequency-ranked significant words, then top bigrams for context.
 */
export function extractKeywords({
	transcript,
	maxKeywords = 3,
}: {
	transcript: string;
	maxKeywords?: number;
}): string[] {
	const tokens = tokenize(transcript);
	if (tokens.length === 0) {
		return [];
	}

	const frequencies = new Map<string, number>();
	for (const token of tokens) {
		frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
	}

	const ranked: WordFrequency[] = [...frequencies.entries()]
		.map(([word, count]) => ({ word, count }))
		.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

	const keywords: string[] = [];
	for (const entry of ranked) {
		if (keywords.length >= maxKeywords) {
			break;
		}
		keywords.push(entry.word);
	}

	if (keywords.length < maxKeywords) {
		const bigrams = new Map<string, number>();
		for (let index = 0; index < tokens.length - 1; index++) {
			const bigram = `${tokens[index]} ${tokens[index + 1]}`;
			bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
		}
		const bestBigram = [...bigrams.entries()]
			.filter(([bigram]) => bigrams.get(bigram) === Math.max(...bigrams.values()))
			.sort((a, b) => a[0].localeCompare(b[0]))[0];
		if (bestBigram) {
			keywords.push(bestBigram[0]);
		}
	}

	return keywords.slice(0, maxKeywords);
}
