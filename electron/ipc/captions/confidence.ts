import type { CaptionCuePayload } from "../types";

type TokenEvidence = { startMs: number; endMs: number; probability?: number };

/** No confidence is inferred from transcript text or an SRT fallback. */
export function parseWhisperTokenEvidence(json: string): TokenEvidence[] {
	try {
		const value = JSON.parse(json);
		if (!Array.isArray(value?.transcription)) return [];
		return value.transcription.flatMap((segment: { tokens?: unknown }) => {
			if (!Array.isArray(segment?.tokens)) return [];
			return segment.tokens.flatMap((token) => {
				if (
					!token ||
					typeof token.text !== "string" ||
					!token.text.trim() ||
					/^(?:\[_[^\]]+\]|<\|[^>]+\|>)$/.test(token.text.trim())
				)
					return [];
				const startMs = token.offsets?.from,
					endMs = token.offsets?.to;
				if (
					!Number.isFinite(startMs) ||
					!Number.isFinite(endMs) ||
					startMs < 0 ||
					endMs < startMs
				)
					return [];
				return [
					{
						startMs,
						endMs,
						...(typeof token.p === "number" &&
						Number.isFinite(token.p) &&
						token.p >= 0 &&
						token.p <= 1
							? { probability: token.p }
							: {}),
					},
				];
			});
		});
	} catch {
		return [];
	}
}

export function attachWhisperConfidence(
	cues: CaptionCuePayload[],
	evidence: TokenEvidence[],
): CaptionCuePayload[] {
	return cues.map((cue) => {
		const spans = cue.words?.length ? cue.words : [cue];
		const matching = evidence.filter((token) =>
			spans.some((span) =>
				token.startMs === token.endMs
					? token.startMs >= span.startMs && token.startMs < span.endMs
					: token.startMs < span.endMs && token.endMs > span.startMs,
			),
		);
		// Partial probability coverage must not turn the known subset into a
		// confident whole sentence. Older JSON/SRT output stays unscored.
		if (!matching.length || matching.some((token) => token.probability === undefined))
			return cue;
		if (
			spans.some(
				(span) =>
					!matching.some(
						(token) => token.startMs < span.endMs && token.endMs > span.startMs,
					),
			)
		)
			return cue;
		const confidence =
			matching.reduce((sum, token) => sum + (token.probability ?? 0), 0) / matching.length;
		return { ...cue, confidence };
	});
}
