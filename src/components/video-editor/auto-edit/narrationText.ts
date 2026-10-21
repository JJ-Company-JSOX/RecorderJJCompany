// Shared by the renderer (subtitles) and the main process (one TTS call per subtitle chunk).
const MAX_CHUNK_CHARS = 28;

/** Splits a narration line at punctuation, then by length, so each subtitle stays short. */
export function splitNarrationLine(text: string): string[] {
	const pieces = text
		.split(/(?<=[，。！？；：,.!?;:])\s*/u)
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
