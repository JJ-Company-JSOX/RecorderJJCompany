import type { AudioRegion } from "../types";

export function audioSourceOffsetMs(region: Pick<AudioRegion, "sourceOffsetMs">): number {
	return Number.isFinite(region.sourceOffsetMs) ? Math.max(0, region.sourceOffsetMs!) : 0;
}

export function splitAudioRegion(
	region: AudioRegion,
	splitMs: number,
	rightId: string,
): AudioRegion[] {
	const boundary = Math.round(splitMs);
	if (!Number.isFinite(boundary) || boundary <= region.startMs || boundary >= region.endMs)
		return [region];
	return [
		{ ...region, endMs: boundary, fadeOutMs: 0 },
		{
			...region,
			id: rightId,
			startMs: boundary,
			sourceOffsetMs: audioSourceOffsetMs(region) + boundary - region.startMs,
			fadeInMs: 0,
		},
	];
}

/** Moving keeps the source offset; resizing the left edge trims the source too. */
export function changeAudioRegionSpan(
	region: AudioRegion,
	span: { start: number; end: number },
	trackIndex?: number,
): AudioRegion {
	if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start)
		return region;
	let startMs = Math.max(0, Math.round(span.start));
	const endMs = Math.max(startMs + 1, Math.round(span.end));
	const durationChanged = Math.abs(endMs - startMs - (region.endMs - region.startMs)) > 1;
	const offset = audioSourceOffsetMs(region);
	if (durationChanged) startMs = Math.max(startMs, region.startMs - offset);
	return {
		...region,
		startMs,
		endMs,
		sourceOffsetMs: durationChanged ? Math.max(0, offset + startMs - region.startMs) : offset,
		...(Number.isFinite(trackIndex)
			? { trackIndex: Math.max(0, Math.floor(trackIndex!)) }
			: {}),
	};
}
