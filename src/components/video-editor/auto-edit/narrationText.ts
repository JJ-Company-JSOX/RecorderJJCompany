// Shared by the renderer (subtitles) and the main process (one TTS call per sentence).
const MAX_CHUNK_CHARS = 28;

/** Splits a narration line at punctuation, then by length, so each subtitle stays short. */
export function splitNarrationLine(text: string): string[] {
	// Latin punctuation ends a piece only before a space, so "2.0" and "e.g." stay whole.
	const pieces = text
		.split(/(?<=[，。！？；：])\s*|(?<=[,.!?;:])\s+/u)
		.map((p) => p.trim())
		.filter(Boolean);
	return pieces.flatMap((piece) => {
		if (piece.length <= MAX_CHUNK_CHARS) return [piece];
		const words = /\s/.test(piece) ? piece.split(/\s+/) : [...piece];
		const joiner = /\s/.test(piece) ? " " : "";
		const chunks: string[] = [];
		let current = "";
		for (const word of words) {
			const next = current ? current + joiner + word : word;
			if (current && next.length > MAX_CHUNK_CHARS) {
				chunks.push(current);
				current = word;
			} else current = next;
		}
		if (current) chunks.push(current);
		return chunks;
	});
}

const CJK_EDGE = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;
/** Joins two pieces of one line: no space next to Chinese text or full-width punctuation. */
export const joinNarrationText = (a: string, b: string) =>
	!a || !b ? a || b : CJK_EDGE.test(a[a.length - 1]) || CJK_EDGE.test(b[0]) ? a + b : `${a} ${b}`;

/** A subtitle chunk ending in one of these also ends its sentence. */
const SENTENCE_END = /[。！？；.!?;]$/u;

/**
 * Groups a line's subtitle chunks into whole sentences, so the voice reads each sentence in
 * one go with its own natural intonation while every subtitle still stays short. It splits
 * only where the subtitles do, so "2.0" and "github.com" stay whole.
 */
export function splitNarrationSentences(text: string) {
	const sentences: Array<{ text: string; chunks: string[] }> = [];
	let chunks: string[] = [];
	for (const chunk of splitNarrationLine(text)) {
		chunks.push(chunk);
		if (!SENTENCE_END.test(chunk)) continue;
		sentences.push({ text: chunks.reduce(joinNarrationText, ""), chunks });
		chunks = [];
	}
	if (chunks.length) sentences.push({ text: chunks.reduce(joinNarrationText, ""), chunks });
	return sentences;
}
