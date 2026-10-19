import type { CaptionCuePayload } from "../types";
import type { SilenceInterval } from "./silence";

/** DTW points are in 10ms units, not word intervals. No word spans are fabricated. */
export function alignWhisperDtwSpeech(
	json: string,
	silences: SilenceInterval[],
	durationMs: number,
): Map<string, CaptionCuePayload> {
	const result = new Map<string, CaptionCuePayload>();
	if (!Number.isFinite(durationMs) || durationMs <= 0) return result;
	let transcription: unknown;
	try {
		transcription = JSON.parse(json).transcription;
	} catch {
		return result;
	}
	if (!Array.isArray(transcription)) return result;
	if (
		silences.some(
			(s) =>
				!Number.isFinite(s.startMs) ||
				s.startMs < 0 ||
				(!Number.isFinite(s.endMs) && s.endMs !== Infinity) ||
				s.endMs <= s.startMs,
		)
	)
		return result;
	const ordered = silences
		.filter(
			(s) =>
				Number.isFinite(s.startMs) &&
				s.startMs >= 0 &&
				(Number.isFinite(s.endMs) || s.endMs === Infinity) &&
				s.endMs > s.startMs,
		)
		.map((s) => ({
			startMs: Math.min(durationMs, s.startMs),
			endMs: Math.min(durationMs, s.endMs),
		}))
		.sort((a, b) => a.startMs - b.startMs);
	const components: Array<{ startMs: number; endMs: number }> = [];
	let cursor = 0;
	for (const silence of ordered) {
		if (silence.startMs > cursor) components.push({ startMs: cursor, endMs: silence.startMs });
		cursor = Math.max(cursor, silence.endMs);
	}
	if (cursor < durationMs) components.push({ startMs: cursor, endMs: durationMs });
	const candidates = transcription.map((segment, index) => {
		const tokens = Array.isArray(segment?.tokens)
			? segment.tokens.filter(
					(token: { text?: unknown }) =>
						typeof token?.text === "string" &&
						token.text.trim() &&
						!/^(?:\[_[^\]]+\]|<\|[^>]+\|>)$/.test(token.text.trim()) &&
						(token.text.includes("\uFFFD") || !/^[\p{P}\p{S}\s]+$/u.test(token.text)),
				)
			: [];
		const anchors = tokens.map((token: { t_dtw?: unknown }) =>
			typeof token.t_dtw === "number" && Number.isFinite(token.t_dtw) && token.t_dtw >= 0
				? token.t_dtw * 10
				: NaN,
		);
		const memberships = anchors.map((anchor: number) =>
			components.findIndex(
				(component) => anchor >= component.startMs && anchor < component.endMs,
			),
		);
		return { segment, index, tokens, anchors, memberships };
	});
	const allAnchors = candidates.flatMap((candidate) => candidate.anchors).filter(Number.isFinite);
	if (allAnchors.some((anchor, index) => index > 0 && anchor < allAnchors[index - 1]))
		return result;
	// Even a partially invalid competing segment reserves any component its
	// real anchors touch. One acoustic component cannot locate two sentences.
	const owners = components.map(
		(_, component) =>
			candidates.filter((candidate) => candidate.memberships.includes(component)).length,
	);
	for (const candidate of candidates) {
		const { segment, index, tokens, anchors, memberships } = candidate;
		if (
			typeof segment?.text !== "string" ||
			!segment.text.trim() ||
			!tokens.length ||
			memberships.some(
				(component: number) => component < 0 || component !== memberships[0],
			) ||
			owners[memberships[0]] !== 1 ||
			anchors.some(
				(anchor: number, index: number) =>
					!Number.isFinite(anchor) || (index > 0 && anchor < anchors[index - 1]),
			)
		)
			continue;
		const componentIndex = memberships[0],
			component = components[componentIndex];
		const startMs = Math.round(
			Math.max(0, components[componentIndex - 1]?.endMs ?? 0, component.startMs - 80),
		);
		const endMs = Math.round(
			Math.min(
				durationMs,
				components[componentIndex + 1]?.startMs ?? durationMs,
				component.endMs + 80,
			),
		);
		if (endMs <= startMs) continue;
		const probabilities = tokens.map((token: { p?: unknown }) => token.p);
		const complete = probabilities.every(
			(p: unknown) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1,
		);
		result.set(`caption-${index + 1}`, {
			id: `caption-${index + 1}`,
			startMs,
			endMs,
			text: segment.text.trim(),
			alignment: "dtw-speech",
			...(complete
				? {
						confidence:
							probabilities.reduce((sum: number, p: number) => sum + p, 0) /
							probabilities.length,
					}
				: {}),
		});
	}
	return result;
}
