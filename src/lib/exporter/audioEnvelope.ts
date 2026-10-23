/** Times are in project milliseconds. Overlapping fades meet at their intersection. */
function fadeDuration(value: number | undefined, durationMs: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.min(durationMs, value!)) : 0;
}

export function audioEnvelopeAt(
	offsetMs: number,
	durationMs: number,
	fadeInMs?: number,
	fadeOutMs?: number,
): number {
	if (!(durationMs > 0) || !Number.isFinite(offsetMs) || offsetMs < 0 || offsetMs > durationMs)
		return 0;
	const fadeIn = fadeDuration(fadeInMs, durationMs);
	const fadeOut = fadeDuration(fadeOutMs, durationMs);
	return Math.max(
		0,
		Math.min(
			1,
			fadeIn > 0 ? offsetMs / fadeIn : 1,
			fadeOut > 0 ? (durationMs - offsetMs) / fadeOut : 1,
		),
	);
}

/** Exact piecewise linear breakpoints, shared by preview evaluation and chunked export. */
export function audioEnvelopeBreakpoints(
	durationMs: number,
	fadeInMs?: number,
	fadeOutMs?: number,
): number[] {
	if (!(durationMs > 0)) return [];
	const fadeIn = fadeDuration(fadeInMs, durationMs);
	const fadeOut = fadeDuration(fadeOutMs, durationMs);
	const points =
		fadeIn + fadeOut > durationMs
			? [0, (durationMs * fadeIn) / (fadeIn + fadeOut), durationMs]
			: [0, fadeIn, durationMs - fadeOut, durationMs];
	return [...new Set(points)].sort((a, b) => a - b);
}
