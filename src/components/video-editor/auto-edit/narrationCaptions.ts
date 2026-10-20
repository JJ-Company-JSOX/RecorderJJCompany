import { captionSpanToSource } from "../captionTimeline";
import { type AudioRegion, type CaptionCue, sortClipRegions } from "../types";
import { type EditState, overlaps, validSpan } from "./plan";

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

/**
 * Turns the generated narration clips (timeline time) into subtitle cues (source time).
 * Each line is split into short chunks timed by character count, and kept inside the clip
 * where its voice starts. Lines that would overlap existing subtitles are skipped.
 */
export function narrationCaptions(
	state: EditState,
	regions: AudioRegion[],
	lines: { id: string; text: string }[],
): CaptionCue[] {
	const clips = sortClipRegions(state.clipRegions);
	const result: CaptionCue[] = [];
	for (const region of regions) {
		const line = lines.find((l) => `narration-${l.id}` === region.id);
		const clip = clips.find((c) => region.startMs >= c.startMs && region.startMs < c.endMs);
		if (!line || !clip) continue;
		const span = captionSpanToSource(clip, { start: region.startMs, end: region.endMs });
		if (!validSpan(span)) continue;
		if ([...state.autoCaptions, ...result].some((c) => overlaps(c, span))) continue;
		const chunks = splitNarrationLine(line.text);
		const total = chunks.reduce((sum, c) => sum + c.length, 0);
		let cursor = span.startMs;
		chunks.forEach((text, index) => {
			const endMs =
				index === chunks.length - 1
					? span.endMs
					: Math.round(cursor + ((span.endMs - span.startMs) * text.length) / total);
			if (endMs > cursor)
				result.push({
					id: `${region.id}-${index + 1}-${crypto.randomUUID()}`,
					startMs: cursor,
					endMs,
					text,
				});
			cursor = endMs;
		});
	}
	return result;
}
