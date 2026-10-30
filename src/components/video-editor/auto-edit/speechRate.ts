/** Learns each language's real spoken pace from this computer's own past syntheses. */
export type SpeechRateSample = { key: string; charsPerSecond: number };
export const SPEECH_RATE_SETTING = "recordly.narrationSpeechRate.v1";

export function validSpeechRateSamples(value: unknown): SpeechRateSample[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(s): s is SpeechRateSample =>
				!!s &&
				typeof s.key === "string" &&
				s.key.length <= 50 &&
				Number.isFinite(s.charsPerSecond) &&
				s.charsPerSecond >= 0.5 &&
				s.charsPerSecond <= 30,
		)
		.slice(-200);
}

/** A sample worth keeping: enough text and audio that a short clip's lead-in silence cannot skew it. */
export function speechRateSample(key: string, textLength: number, durationMs: number) {
	if (textLength < 10 || !Number.isFinite(durationMs) || durationMs < 500) return null;
	const charsPerSecond = textLength / (durationMs / 1000);
	return Number.isFinite(charsPerSecond) && charsPerSecond >= 0.5 && charsPerSecond <= 30
		? { key, charsPerSecond }
		: null;
}

/**
 * A deliberately slow-biased pick from the most recent matching samples, not their average pace.
 * The budget this feeds only ever constrains how much text gets written; writing to the average
 * observed pace would still run long about half the time, since half of any real pace varies
 * faster and half slower. Erring slow costs a little unused scene time; erring fast is the
 * rejected-script problem this exists to fix.
 */
export function estimateCharsPerSecond(
	samples: SpeechRateSample[],
	key: string,
	fallback: number,
): number {
	const matches = samples
		.filter((s) => s.key === key)
		.slice(-8)
		.map((s) => s.charsPerSecond)
		.sort((a, b) => a - b);
	if (!matches.length) return fallback;
	return matches[Math.max(0, Math.ceil(matches.length * 0.25) - 1)];
}
