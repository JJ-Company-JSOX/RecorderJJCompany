import { captionMatchesClip } from "../captionTimeline";
import {
	getClipSourceEndMs,
	getClipSourceStartMs,
	sortClipRegions,
	type CaptionCue,
	type ClipRegion,
} from "../types";
import type { StoryBrief, StoryScene } from "./story";

export interface StoryTranscriptCue {
	startMs: number;
	endMs: number;
	text: string;
}
export const MAX_STORY_TEXT_CHARACTERS = 4000;
export const MAX_STORY_TRANSCRIPT_CHARACTERS = 3000;
export const MAX_STORY_TRANSCRIPT_CUES = 80;
export const MAX_STORY_TRANSCRIPT_CUE_CHARACTERS = 500;
/** Conservative character guard, not a model-token count or context-fit guarantee. */
export const storyTextBudget = (brief: Pick<StoryBrief, "analyzeVideo">) =>
	brief.analyzeVideo ? 2000 : MAX_STORY_TEXT_CHARACTERS;
export const storyBriefCharacterCount = (brief: StoryBrief) =>
	[brief.topic, brief.audience, brief.facts, brief.ending, brief.notes].reduce(
		(sum, value) => sum + value.length,
		0,
	);

function mergeStoryWindows(spans: { startMs: number; endMs: number }[]) {
	const merged: { startMs: number; endMs: number }[] = [];
	for (const span of [...spans]
		.filter((s) => s.endMs > s.startMs)
		.sort((a, b) => a.startMs - b.startMs)) {
		const last = merged[merged.length - 1];
		if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
		else merged.push({ ...span });
	}
	return merged;
}
export const storySpanCoveredByScenes = (
	span: { startMs: number; endMs: number },
	scenes: { startMs: number; endMs: number }[],
) =>
	mergeStoryWindows(scenes).some(
		(window) => span.startMs >= window.startMs && span.endMs <= window.endMs,
	);

/** Existing edited captions are evidence, not a claim that a model listened to source audio. */
export function buildStoryTranscript(
	captions: CaptionCue[],
	clips: ClipRegion[],
	scenes?: StoryScene[],
	maxCharacters = MAX_STORY_TRANSCRIPT_CHARACTERS,
) {
	const budget = Number.isFinite(maxCharacters)
		? Math.max(0, Math.min(MAX_STORY_TRANSCRIPT_CHARACTERS, Math.floor(maxCharacters)))
		: 0;
	const mapped: StoryTranscriptCue[] = [];
	let omittedPartialCues = 0;
	for (const clip of sortClipRegions(clips)) {
		if (!Number.isFinite(clip.speed) || clip.speed <= 0 || clip.endMs <= clip.startMs) continue;
		const clipStart = getClipSourceStartMs(clip),
			clipEnd = getClipSourceEndMs(clip);
		const windows = mergeStoryWindows(
			(scenes ?? [{ startMs: clip.startMs, endMs: clip.endMs }]).map((s) => ({
				startMs: Math.max(s.startMs, clip.startMs),
				endMs: Math.min(s.endMs, clip.endMs),
			})),
		);
		for (const cue of captions) {
			if (
				!cue ||
				typeof cue.id !== "string" ||
				cue.id.startsWith("narration-") ||
				typeof cue.text !== "string" ||
				!cue.text.trim() ||
				!Number.isFinite(cue.startMs) ||
				!Number.isFinite(cue.endMs) ||
				cue.endMs <= cue.startMs ||
				!captionMatchesClip(cue, clip)
			)
				continue;
			for (const window of windows) {
				let sourceStart = Math.max(
					cue.startMs,
					clipStart,
					clipStart + (window.startMs - clip.startMs) * clip.speed,
				);
				let sourceEnd = Math.min(
					cue.endMs,
					clipEnd,
					clipStart + (window.endMs - clip.startMs) * clip.speed,
				);
				if (sourceStart >= sourceEnd) continue;
				let text = cue.text.trim();
				if (sourceStart !== cue.startMs || sourceEnd !== cue.endMs) {
					// Without word alignment a fragment's text can include speech removed by the cut.
					const words = cue.words?.filter(
						(w) =>
							typeof w.text === "string" &&
							w.text.trim() &&
							Number.isFinite(w.startMs) &&
							Number.isFinite(w.endMs) &&
							w.endMs > w.startMs &&
							w.startMs >= sourceStart &&
							w.endMs <= sourceEnd,
					);
					if (!words?.length) {
						omittedPartialCues++;
						continue;
					}
					text = words
						.map((w) => `${w.leadingSpace ? " " : ""}${w.text}`)
						.join("")
						.trim();
					sourceStart = Math.min(...words.map((w) => w.startMs));
					sourceEnd = Math.max(...words.map((w) => w.endMs));
				}
				const startMs = Math.round(clip.startMs + (sourceStart - clipStart) / clip.speed);
				const endMs = Math.round(clip.startMs + (sourceEnd - clipStart) / clip.speed);
				if (!text || endMs <= startMs) continue;
				mapped.push({ startMs, endMs, text });
			}
		}
	}
	mapped.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
	const eligible = mapped.filter(
		(c) => c.text.length <= MAX_STORY_TRANSCRIPT_CUE_CHARACTERS && c.text.length <= budget,
	);
	// Reduce the number of evenly spread whole cues until the budget fits. Never cut words.
	let selected: StoryTranscriptCue[] = [];
	for (let count = Math.min(MAX_STORY_TRANSCRIPT_CUES, eligible.length); count > 0; count--) {
		const candidate =
			count === 1
				? [eligible[Math.floor(eligible.length / 2)]]
				: Array.from(
						{ length: count },
						(_, i) => eligible[Math.round((i * (eligible.length - 1)) / (count - 1))],
					);
		if (candidate.reduce((sum, c) => sum + c.text.length, 0) <= budget) {
			selected = candidate;
			break;
		}
	}
	const totalCues = mapped.length + omittedPartialCues;
	return {
		cues: selected,
		totalCues,
		includedCues: selected.length,
		omittedCues: totalCues - selected.length,
		omittedPartialCues,
		totalCharacters: mapped.reduce((sum, c) => sum + c.text.length, 0),
		includedCharacters: selected.reduce((sum, c) => sum + c.text.length, 0),
		truncated: selected.length < totalCues,
	};
}
