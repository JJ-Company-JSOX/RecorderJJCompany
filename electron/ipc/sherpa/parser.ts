export type SherpaCaption = {
	startMs: number;
	endMs: number;
	text: string;
	alignment: "model-segment" | "audio-chunk";
	// Missing probabilities remain missing: this engine is not a safe-cut oracle.
	confidence?: number;
};

export function parseSherpaCaptionResult(
	json: string,
	chunkStartMs: number,
	chunkDurationMs: number,
): SherpaCaption[] {
	if (
		!Number.isFinite(chunkStartMs) ||
		chunkStartMs < 0 ||
		!Number.isFinite(chunkDurationMs) ||
		chunkDurationMs <= 0
	)
		throw new Error("Invalid Sherpa audio interval.");
	const data = JSON.parse(json) as Record<string, unknown>;
	if (!data || typeof data !== "object" || typeof data.text !== "string")
		throw new Error("Invalid Sherpa recognition result.");
	const text = data.text.replace(/<\|[^|]*\|>/g, "").trim();
	if (!text) return [];
	const starts = data.segment_timestamps;
	const durations = data.segment_durations;
	const texts = data.segment_texts;
	if (
		Array.isArray(starts) &&
		Array.isArray(durations) &&
		Array.isArray(texts) &&
		starts.length > 0 &&
		starts.length === durations.length &&
		starts.length === texts.length
	) {
		const result: SherpaCaption[] = [];
		let lastEnd = 0;
		for (let i = 0; i < starts.length; i++) {
			const start = starts[i],
				duration = durations[i],
				part = texts[i];
			if (
				typeof start !== "number" ||
				!Number.isFinite(start) ||
				start < lastEnd ||
				start * 1000 >= chunkDurationMs ||
				typeof duration !== "number" ||
				!Number.isFinite(duration) ||
				duration <= 0 ||
				(start + duration) * 1000 > chunkDurationMs + 150 ||
				typeof part !== "string" ||
				!part.trim()
			) {
				return [
					{
						startMs: chunkStartMs,
						endMs: chunkStartMs + chunkDurationMs,
						text,
						alignment: "audio-chunk",
					},
				];
			}
			lastEnd = start + duration;
			result.push({
				startMs: chunkStartMs + start * 1000,
				endMs: chunkStartMs + Math.min(chunkDurationMs, lastEnd * 1000),
				text: part.trim(),
				alignment: "model-segment",
			});
		}
		return result;
	}
	return [
		{
			startMs: chunkStartMs,
			endMs: chunkStartMs + chunkDurationMs,
			text,
			alignment: "audio-chunk",
		},
	];
}
