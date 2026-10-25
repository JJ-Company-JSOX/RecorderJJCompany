import { captionMatchesClip, captionSpanToSource } from "../captionTimeline";
import { type AudioRegion, type CaptionCue, sortClipRegions } from "../types";
import { type EditState, overlaps, validSpan } from "./plan";
import { splitNarrationLine } from "./narrationText";

export { splitNarrationLine } from "./narrationText";

/** Where each subtitle chunk's speech ends, in ms from the start of its voice clip. */
export type ChunkTiming = { text: string; endMs: number }[];

/** Estimated chunk ends when the voice did not report real ones (by character count). */
function estimatedTiming(text: string, durationMs: number): ChunkTiming {
	const chunks = splitNarrationLine(text);
	const total = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
	let elapsed = 0;
	return chunks.map((chunk, index) => {
		elapsed += chunk.length;
		return {
			text: chunk,
			endMs:
				index === chunks.length - 1
					? durationMs
					: Math.round((durationMs * elapsed) / total),
		};
	});
}

/**
 * Turns the generated narration clips (timeline time) into subtitle cues (source time).
 * Each chunk is timed by when its speech actually ends (from the voice) and mapped into
 * the clip it plays over, so a line may cross a cut. Chunks that would land on an
 * existing subtitle, or after the end of the video, are skipped and counted.
 */
export function narrationCaptions(
	state: EditState,
	regions: AudioRegion[],
	lines: { id: string; text: string }[],
	timings: Record<string, ChunkTiming> = {},
): { cues: CaptionCue[]; skipped: number } {
	const clips = sortClipRegions(state.clipRegions);
	const cues: CaptionCue[] = [];
	let skipped = 0;
	for (const region of regions) {
		const line = lines.find((l) => `narration-${l.id}` === region.id);
		if (!line) continue;
		const timing =
			timings[line.id] ?? estimatedTiming(line.text, region.endMs - region.startMs);
		let chunkStart = region.startMs;
		timing.forEach((chunk, index) => {
			const start = chunkStart;
			const end = region.startMs + chunk.endMs;
			chunkStart = end;
			const pieces = clips.filter((clip) => start < clip.endMs && end > clip.startMs);
			if (!pieces.length) skipped++;
			for (const clip of pieces) {
				const span = captionSpanToSource(clip, { start, end });
				if (
					!validSpan(span) ||
					[...state.autoCaptions, ...cues].some(
						(c) => captionMatchesClip(c, clip) && overlaps(c, span),
					)
				) {
					skipped++;
					continue;
				}
				cues.push({
					id: `${region.id}-${index + 1}-${crypto.randomUUID()}`,
					clipId: clip.id,
					startMs: span.startMs,
					endMs: span.endMs,
					text: chunk.text,
				});
			}
		});
	}
	return { cues, skipped };
}
