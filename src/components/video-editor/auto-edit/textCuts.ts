import { projectCaptionCues } from "../captionTimeline";
import {
	baselineFor,
	conflictFor,
	type EditPlan,
	type EditState,
	type EditSuggestion,
	validSpan,
} from "./plan";

/** Breathing room cut around a deleted sentence, never into a neighbouring sentence. */
const EDGE_MS = 150;
/** Two deleted sentences closer than this also lose the pause between them. */
const JOIN_MS = 1500;

export interface TextLine {
	/** Source caption id. */
	id: string;
	text: string;
	/** Timeline position of the line's first visible fragment. */
	startMs: number;
	endMs: number;
}

/** Subtitle lines in timeline order, as they appear in the edited video. */
export function textLines(state: EditState): TextLine[] {
	const seen = new Map<string, TextLine>();
	for (const fragment of projectCaptionCues(state.autoCaptions, state.clipRegions)) {
		if (!fragment.text.trim()) continue;
		const line = seen.get(fragment.sourceCueId);
		if (line) line.endMs = Math.max(line.endMs, fragment.endMs);
		else
			seen.set(fragment.sourceCueId, {
				id: fragment.sourceCueId,
				text: fragment.text.trim(),
				startMs: fragment.startMs,
				endMs: fragment.endMs,
			});
	}
	return [...seen.values()].sort((a, b) => a.startMs - b.startMs);
}

/**
 * Like AutoCut/FunClip: deleting subtitle lines cuts their part of the video.
 * Works in timeline time, one cut per clip fragment, and keeps the plan's usual
 * Apply/Undo transaction.
 */
export function buildTextCutPlan(
	state: EditState,
	source: string,
	deletedIds: string[],
	id: string,
): EditPlan {
	const deleted = new Set(deletedIds);
	const fragments = projectCaptionCues(state.autoCaptions, state.clipRegions)
		.filter((f) => f.text.trim())
		.sort((a, b) => a.startMs - b.startMs);
	const cuts: { startMs: number; endMs: number; clipId: string; text: string[] }[] = [];
	for (const fragment of fragments) {
		if (!deleted.has(fragment.sourceCueId)) continue;
		const kept = fragments.filter(
			(f) => !deleted.has(f.sourceCueId) && f.clip.id === fragment.clip.id,
		);
		const before = Math.max(
			fragment.clip.startMs,
			...kept.filter((f) => f.endMs <= fragment.startMs).map((f) => f.endMs),
		);
		const after = Math.min(
			fragment.clip.endMs,
			...kept.filter((f) => f.startMs >= fragment.endMs).map((f) => f.startMs),
		);
		const cut = {
			startMs: Math.round(Math.max(before, fragment.startMs - EDGE_MS)),
			endMs: Math.round(Math.min(after, fragment.endMs + EDGE_MS)),
			clipId: fragment.clip.id,
			text: [fragment.text.trim()],
		};
		const last = cuts[cuts.length - 1];
		const between = last && { startMs: last.endMs, endMs: cut.startMs };
		if (
			last &&
			between &&
			last.clipId === cut.clipId &&
			cut.startMs - last.endMs < JOIN_MS &&
			!kept.some((f) => f.startMs < between.endMs && between.startMs < f.endMs)
		) {
			last.endMs = Math.max(last.endMs, cut.endMs);
			last.text.push(...cut.text);
		} else cuts.push(cut);
	}
	const suggestions: EditSuggestion[] = cuts.filter(validSpan).map((cut, index) => ({
		id: `text-cut-${index + 1}`,
		kind: "trim",
		reason: "transcript",
		startMs: cut.startMs,
		endMs: cut.endMs,
		text: cut.text.join(" "),
	}));
	for (const suggestion of suggestions) suggestion.blocked = conflictFor(suggestion, state);
	return {
		version: 1,
		id,
		coordinateSpace: "timeline-ms",
		baseline: baselineFor(state, source),
		suggestions,
		warnings: [],
		reviewer: "rules",
	};
}
