import { spansOverlap } from "../../core/spans";
import type { TimelineAudioRegion } from "../../core/timelineTypes";

interface ResolveAudioPlacementParams {
	audioRegions: TimelineAudioRegion[];
	startPos: number;
	totalMs: number;
	audioDurationMs: number;
	preferredTrackIndex?: number;
}

interface AudioPlacement {
	trackIndex: number;
	durationMs: number;
}

export function resolveAudioPlacement({
	audioRegions,
	startPos,
	totalMs,
	audioDurationMs,
	preferredTrackIndex,
}: ResolveAudioPlacementParams): AudioPlacement | null {
	const maxRemainingDuration = totalMs - startPos;
	if (audioDurationMs <= 0 || maxRemainingDuration <= 0) {
		return null;
	}

	const desiredDuration = Math.min(audioDurationMs, maxRemainingDuration);
	const normalizedPreferredTrackIndex = Number.isFinite(preferredTrackIndex)
		? Math.max(0, Math.floor(preferredTrackIndex ?? 0))
		: null;
	const maxTrackIndex = audioRegions.reduce(
		(max, region) => Math.max(max, region.trackIndex ?? 0),
		-1,
	);
	const candidateTrackIndexes =
		normalizedPreferredTrackIndex === null
			? Array.from({ length: maxTrackIndex + 2 }, (_, index) => index)
			: [normalizedPreferredTrackIndex];

	const getGapForTrack = (trackIndex: number) => {
		const trackRegions = audioRegions
			.filter((region) => (region.trackIndex ?? 0) === trackIndex)
			.sort((left, right) => left.startMs - right.startMs);
		const desiredSpan = {
			start: startPos,
			end: startPos + desiredDuration,
		};

		const overlappingRegion = trackRegions.find((region) =>
			spansOverlap(desiredSpan, { start: region.startMs, end: region.endMs }),
		);
		if (overlappingRegion) {
			return 0;
		}

		const nextRegion = trackRegions.find((region) => region.startMs > startPos);
		return nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;
	};

	let selectedTrackIndex: number | null = null;
	let availableGap = 0;

	for (const trackIndex of candidateTrackIndexes) {
		const gap = getGapForTrack(trackIndex);
		if (gap >= desiredDuration) {
			selectedTrackIndex = trackIndex;
			availableGap = gap;
			break;
		}
	}

	if (selectedTrackIndex === null && normalizedPreferredTrackIndex === null) {
		for (const trackIndex of candidateTrackIndexes) {
			const gap = getGapForTrack(trackIndex);
			if (gap > 0) {
				selectedTrackIndex = trackIndex;
				availableGap = gap;
				break;
			}
		}
	}

	if (selectedTrackIndex === null || availableGap <= 0) {
		return null;
	}

	return {
		trackIndex: selectedTrackIndex,
		durationMs: Math.min(audioDurationMs, availableGap, totalMs - startPos),
	};
}

export interface PlacedAudioClip {
	audioPath: string;
	startMs: number;
	endMs: number;
	trackIndex: number;
	/** The clip was shortened to the room it had (usually the end of the video). */
	trimmed: boolean;
}

/**
 * Reserves one track for the entire sequence, including pauses between paragraphs. Looking
 * only at the first paragraph could choose a track occupied by music later in the sequence.
 * Stops at the end of the video without extending or changing the screen clips.
 */
export function placeAudioClips({
	audioRegions,
	startPos,
	totalMs,
	clips,
	gapMs,
}: {
	audioRegions: TimelineAudioRegion[];
	startPos: number;
	totalMs: number;
	clips: Array<{ audioPath: string; durationMs: number }>;
	gapMs: number;
}): PlacedAudioClip[] {
	if (!clips.length) return [];
	const sequenceDuration =
		clips.reduce((sum, clip) => sum + clip.durationMs, 0) +
		Math.max(0, clips.length - 1) * gapMs;
	const sequencePlacement = resolveAudioPlacement({
		audioRegions,
		startPos,
		totalMs,
		audioDurationMs: sequenceDuration,
	});
	if (!sequencePlacement) return [];
	const regions = [...audioRegions];
	const placed: PlacedAudioClip[] = [];
	let start = startPos;
	const trackIndex = sequencePlacement.trackIndex;
	for (const clip of clips) {
		const placement = resolveAudioPlacement({
			audioRegions: regions,
			startPos: start,
			totalMs,
			audioDurationMs: clip.durationMs,
			preferredTrackIndex: trackIndex,
		});
		if (!placement) break;
		const endMs = start + placement.durationMs;
		placed.push({
			audioPath: clip.audioPath,
			startMs: start,
			endMs,
			trackIndex: placement.trackIndex,
			trimmed: placement.durationMs < clip.durationMs,
		});
		regions.push({
			id: `placed-${placed.length}`,
			startMs: start,
			endMs,
			trackIndex: placement.trackIndex,
		});
		start = endMs + gapMs;
	}
	return placed;
}
