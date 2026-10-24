/** The main process reads at most 500 UTF-16 characters per cue and 200 cues per job. */
export const MAX_SEGMENT_CHARS = 500;
export const MAX_SEGMENTS = 200;
export const MAX_SPEECH_TEXT_CHARS = 5000;

/** Paragraphs become separate clips. Long paragraphs split at punctuation or spaces. */
export function speechSegments(text: string, maxChars = MAX_SEGMENT_CHARS): string[] {
	const limit = Number.isFinite(maxChars) ? Math.max(2, Math.floor(maxChars)) : MAX_SEGMENT_CHARS;
	return text.split(/\r?\n/).flatMap((paragraph) => {
		let rest = paragraph.replace(/\s+/g, " ").trim();
		const parts: string[] = [];
		while (rest.length > limit) {
			const prefix = rest.slice(0, limit);
			const endings = [...prefix.matchAll(/[。！？；]|[.!?;](?=\s|$)/gu)];
			const ending = endings[endings.length - 1];
			const sentenceEnd = ending ? ending.index! + ending[0].length : 0;
			const space = prefix.lastIndexOf(" ");
			let cut = sentenceEnd || (space > 0 ? space : limit);
			if (/[\uD800-\uDBFF]$/.test(rest.slice(0, cut))) cut--;
			parts.push(rest.slice(0, cut).trim());
			rest = rest.slice(cut).trimStart();
		}
		if (rest) parts.push(rest);
		return parts;
	});
}

/** Kokoro's Chinese voice can also read English labels in mixed text. */
export const speechLanguage = (text: string): "zh" | "en" =>
	/\p{Script=Han}/u.test(text) ? "zh" : "en";
