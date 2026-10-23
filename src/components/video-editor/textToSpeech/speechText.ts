import {
	joinNarrationText,
	splitNarrationLine,
	splitNarrationSentences,
} from "../auto-edit/narrationText";

/** The main process reads at most 500 characters per line and 200 lines per job. */
export const MAX_SEGMENT_CHARS = 500;
export const MAX_SEGMENTS = 200;
export const MAX_SPEECH_TEXT_CHARS = 5000;

/** Packs pieces of one paragraph into segments of at most maxChars. */
function pack(pieces: string[], maxChars: number) {
	const segments: string[] = [];
	let current = "";
	for (const piece of pieces) {
		const next = joinNarrationText(current, piece);
		if (current && next.length > maxChars) {
			segments.push(current);
			current = piece;
		} else current = next;
	}
	if (current) segments.push(current);
	return segments;
}

/**
 * Splits typed text into the lines the voice reads, one audio clip each: every paragraph on its
 * own, and a long paragraph at sentence ends (or, for one very long sentence, at its subtitle
 * breaks) so no line is longer than maxChars.
 */
export function speechSegments(text: string, maxChars = MAX_SEGMENT_CHARS): string[] {
	return text
		.split(/\r?\n/)
		.map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.flatMap((paragraph) => {
			if (paragraph.length <= maxChars) return [paragraph];
			const sentences = splitNarrationSentences(paragraph).flatMap((sentence) =>
				sentence.text.length <= maxChars
					? [sentence.text]
					: pack(splitNarrationLine(sentence.text), maxChars),
			);
			return pack(sentences, maxChars);
		});
}

/** The voice language a text most likely needs: Chinese as soon as it has Chinese characters. */
export const speechLanguage = (text: string): "zh" | "en" =>
	/\p{Script=Han}/u.test(text) ? "zh" : "en";
