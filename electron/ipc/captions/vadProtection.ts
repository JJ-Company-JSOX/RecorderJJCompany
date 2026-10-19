/** Source-coordinate speech evidence. VAD never establishes transcript meaning. */
export interface VadEvidence {
	durationMs: number;
	segments: Array<{ startMs: number; endMs: number }>;
}

export function mergeVadEvidence(tracks: Array<VadEvidence | null>): VadEvidence | null {
	if (!tracks.length || tracks.some((track) => !track)) return null;
	const present = tracks as VadEvidence[];
	const segments: VadEvidence["segments"] = [];
	for (const span of present
		.flatMap((track) => track.segments)
		.sort((a, b) => a.startMs - b.startMs)) {
		const last = segments[segments.length - 1];
		if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
		else segments.push({ ...span });
	}
	return { durationMs: Math.max(...present.map((track) => track.durationMs)), segments };
}

/** Silence edits may only retain measured silence outside padded voice ranges. */
export function protectSilenceWithVad(
	ranges: Array<{ startMs: number; endMs: number }>,
	evidence: VadEvidence | null,
) {
	if (!evidence) return [];
	return ranges.flatMap((range) => {
		let parts = [
			{
				startMs: Math.max(0, range.startMs),
				endMs: Math.min(evidence.durationMs, range.endMs),
			},
		];
		for (const speech of evidence.segments)
			parts = parts.flatMap((part) => {
				const start = Math.max(0, speech.startMs - 200),
					end = Math.min(evidence.durationMs, speech.endMs + 200);
				if (end <= part.startMs || start >= part.endMs) return [part];
				return [
					{ startMs: part.startMs, endMs: Math.min(start, part.endMs) },
					{ startMs: Math.max(end, part.startMs), endMs: part.endMs },
				].filter((p) => p.endMs > p.startMs);
			});
		return parts.filter((p) => p.endMs > p.startMs);
	});
}

export function parseVadEvidence(raw: string): VadEvidence {
	if (raw.length > 2_000_000) throw Error("VAD output exceeds limit");
	const value = JSON.parse(raw);
	if (
		value?.version !== 1 ||
		value.sampleRate !== 16000 ||
		!Number.isSafeInteger(value.durationSamples) ||
		value.durationSamples <= 0 ||
		value.durationSamples > 16000 * 600 ||
		!Array.isArray(value.segments) ||
		value.segments.length > 20000
	)
		throw Error("Invalid VAD evidence");
	let end = 0;
	const segments = value.segments.map((segment: { startSample: number; endSample: number }) => {
		if (
			!segment ||
			!Number.isSafeInteger(segment.startSample) ||
			!Number.isSafeInteger(segment.endSample) ||
			segment.startSample < end ||
			segment.endSample <= segment.startSample ||
			segment.endSample > value.durationSamples
		)
			throw Error("Invalid or overlapping VAD speech ranges");
		end = segment.endSample;
		return { startMs: segment.startSample / 16, endMs: segment.endSample / 16 };
	});
	return { durationMs: value.durationSamples / 16, segments };
}

/**
 * Require acoustic agreement for the complete phrase and safe cut edges.
 * A confirmed repeated phrase may contain speech; its neighboring speech must
 * never cross either cut edge. Missing/empty evidence cannot approve a deletion.
 */
export function hasVadProtectedBoundaries(
	cue: { startMs: number; endMs: number },
	evidence: VadEvidence,
): boolean {
	if (
		!Number.isFinite(cue.startMs) ||
		!Number.isFinite(cue.endMs) ||
		cue.startMs < 0 ||
		cue.endMs <= cue.startMs ||
		cue.endMs > evidence.durationMs
	)
		return false;
	const overlaps = evidence.segments.filter(
		(segment) => segment.startMs < cue.endMs && cue.startMs < segment.endMs,
	);
	if (!overlaps.length) return false;
	// Existing DTW phrase padding is 80 ms. A VAD boundary must remain at least
	// 64 ms (two inference frames) inside that phrase; do not move the cut itself.
	const edgePadMs = 64;
	if (
		overlaps.some(
			(segment) =>
				(segment.startMs - edgePadMs < cue.startMs && cue.startMs !== 0) ||
				(segment.endMs + edgePadMs > cue.endMs && cue.endMs !== evidence.durationMs),
		)
	)
		return false;
	return true;
}

/** Reconcile independent DTW and VAD phrase bounds without shrinking speech.
 * Only an exclusive acoustic phrase can grow, by at most 250 ms per edge.
 * Shared VAD segments, neighboring captions and uncertain alignment stay blocked.
 */
export function protectVadAlignedCues<
	T extends { startMs: number; endMs: number; alignment?: string },
>(cues: T[], evidence: VadEvidence): Array<T & { vadBoundaryVerified: boolean }> {
	return cues.map((cue) => {
		const denied = { ...cue, vadBoundaryVerified: false };
		if (cue.alignment !== "dtw-speech") return denied;
		const voice = evidence.segments.filter(
			(s) => s.startMs < cue.endMs && cue.startMs < s.endMs,
		);
		if (
			!voice.length ||
			voice.some((s) =>
				cues.some(
					(other) => other !== cue && other.startMs < s.endMs && s.startMs < other.endMs,
				),
			)
		)
			return denied;
		const startMs = Math.floor(Math.max(0, Math.min(cue.startMs, voice[0].startMs - 64)));
		const endMs = Math.ceil(
			Math.min(evidence.durationMs, Math.max(cue.endMs, voice[voice.length - 1].endMs + 64)),
		);
		if (
			cue.startMs - startMs > 250 ||
			endMs - cue.endMs > 250 ||
			cues.some((other) => other !== cue && other.startMs < endMs && startMs < other.endMs)
		)
			return denied;
		const candidate = { ...cue, startMs, endMs };
		return {
			...candidate,
			vadBoundaryVerified: hasVadProtectedBoundaries(candidate, evidence),
		};
	});
}
