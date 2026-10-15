import { getClipSourceStartMs } from "../types";
import {
	baselineFor,
	conflictFor,
	overlaps,
	validSpan,
	type EditPlan,
	type EditState,
	type EditSuggestion,
} from "./plan";

/** Times refer to the original video, never the edited timeline. Coordinates span the full frame. */
export interface VisualObservation {
	timeMs: number;
	focus: { cx: number; cy: number } | null;
	caption: string;
	rationale: string;
}
export interface VisualAnalysis {
	observations: VisualObservation[];
	sampledTimesMs: number[];
	durationMs: number;
	model: string;
	elapsedMs: number;
}

export function parseVisualResponse(raw: unknown, timeMs: number): VisualObservation {
	if (!raw || typeof raw !== "object") throw Error("Invalid visual model response");
	const value = raw as Record<string, unknown>;
	if (
		typeof value.caption !== "string" ||
		value.caption.length > 240 ||
		typeof value.rationale !== "string" ||
		value.rationale.length > 500
	)
		throw Error("Invalid visual text");
	let focus: VisualObservation["focus"] = null;
	if (value.focus !== null) {
		if (!value.focus || typeof value.focus !== "object") throw Error("Invalid visual focus");
		const f = value.focus as Record<string, unknown>;
		if (
			typeof f.cx !== "number" ||
			typeof f.cy !== "number" ||
			!Number.isFinite(f.cx) ||
			!Number.isFinite(f.cy) ||
			f.cx < 0 ||
			f.cx > 1 ||
			f.cy < 0 ||
			f.cy > 1
		)
			throw Error("Visual coordinates must be normalized to 0..1");
		focus = { cx: f.cx, cy: f.cy };
	}
	return { timeMs, focus, caption: value.caption.trim(), rationale: value.rationale.trim() };
}

/** Adds only visual suggestions. Destructive time edits remain constrained to rule evidence. */
export function addVisualSuggestions(
	plan: EditPlan,
	state: EditState,
	source: string,
	analysis: VisualAnalysis,
): EditPlan {
	if (plan.baseline !== baselineFor(state, source))
		throw Error("Timeline changed during visual analysis");
	if (
		!Array.isArray(analysis.observations) ||
		analysis.observations.length > 12 ||
		!Number.isFinite(analysis.durationMs) ||
		analysis.durationMs <= 0
	)
		throw Error("Invalid visual analysis");
	const suggestions = plan.suggestions.filter((s) => s.reason !== "vision");
	const add = (suggestion: Omit<EditSuggestion, "id">) => {
		if (!validSpan(suggestion)) return;
		// Avoid competing suggestions across closely spaced samples and existing rule zooms.
		if (suggestions.some((s) => s.kind === suggestion.kind && overlaps(s, suggestion))) return;
		const next = { ...suggestion, id: `vision-${suggestions.length + 1}` };
		suggestions.push({ ...next, blocked: conflictFor(next, state) });
	};
	for (const raw of analysis.observations) {
		if (!Number.isFinite(raw.timeMs) || raw.timeMs < 0 || raw.timeMs >= analysis.durationMs)
			throw Error("Invalid sample time");
		const observation = parseVisualResponse(raw, raw.timeMs);
		for (const clip of state.clipRegions) {
			const start = getClipSourceStartMs(clip),
				end = start + (clip.endMs - clip.startMs) * clip.speed;
			if (observation.timeMs < start || observation.timeMs >= end) continue;
			const span = {
				startMs: Math.round(
					clip.startMs + (Math.max(start, observation.timeMs - 500) - start) / clip.speed,
				),
				endMs: Math.round(
					clip.startMs +
						(Math.min(end, observation.timeMs + 1800, analysis.durationMs) - start) /
							clip.speed,
				),
			};
			if (observation.focus)
				add({
					...span,
					kind: "zoom",
					reason: "vision",
					focus: observation.focus,
					depth: 2,
					text: observation.rationale,
				});
			if (observation.caption)
				add({ ...span, kind: "annotation", reason: "vision", text: observation.caption });
		}
	}
	return {
		...plan,
		visualAnalysis: analysis,
		suggestions,
		reviewer: "local-ai",
		warnings: [...plan.warnings.filter((w) => !w.startsWith("vision-")), "vision-sampled-only"],
	};
}
