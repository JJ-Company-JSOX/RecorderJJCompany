import { type ClipRegion, type CursorTelemetryPoint, getClipSourceStartMs } from "../types";
import {
	baselineFor,
	conflictFor,
	type EditPlan,
	type EditState,
	type EditSuggestion,
	overlaps,
	type Span,
	validSpan,
} from "./plan";
import { assertSpeechTranscript, type SpeechAnalysis, speechCutIssue } from "./speechTypes";

function projectWholeCue(cue: Span, clip: ClipRegion) {
	const start = getClipSourceStartMs(clip),
		end = start + (clip.endMs - clip.startMs) * clip.speed;
	if (cue.startMs < start || cue.endMs > end) return null;
	const span = {
		startMs: Math.round(clip.startMs + (cue.startMs - start) / clip.speed),
		endMs: Math.round(clip.startMs + (cue.endMs - start) / clip.speed),
	};
	return validSpan(span) && span.startMs >= clip.startMs && span.endMs <= clip.endMs
		? span
		: null;
}

/** Merge a draft only. Captions stay in source space; trim suggestions use timeline space. */
export function addSpeechSuggestions(
	plan: EditPlan,
	state: EditState,
	source: string,
	analysis: SpeechAnalysis,
	context: { cursor?: CursorTelemetryPoint[]; staticRanges?: Span[] } = {},
): EditPlan {
	if (plan.baseline !== baselineFor(state, source)) throw Error("stale-plan");
	assertSpeechTranscript(analysis?.transcript);
	if (
		analysis.version !== 1 ||
		!Array.isArray(analysis.cuts) ||
		analysis.cuts.length > 5000 ||
		!Array.isArray(analysis.warnings) ||
		analysis.warnings.some((warning) => typeof warning !== "string" || warning.length > 120)
	)
		throw Error("Invalid speech analysis");
	const transcript = analysis.transcript,
		byId = new Map(transcript.cues.map((cue) => [cue.id, cue])),
		warnings = new Set([...plan.warnings, ...analysis.warnings, "speech-review-required"]);
	const projections = transcript.cues.flatMap((cue) =>
		state.clipRegions.flatMap((clip) => {
			// Even a partially retained cue protects its audible portion from silence cuts.
			const start = getClipSourceStartMs(clip),
				end = start + (clip.endMs - clip.startMs) * clip.speed;
			const span = {
				startMs: Math.max(
					clip.startMs,
					clip.startMs + (cue.startMs - 200 - start) / clip.speed,
				),
				endMs: Math.min(clip.endMs, clip.startMs + (cue.endMs + 200 - start) / clip.speed),
			};
			return cue.startMs < end && cue.endMs > start && validSpan(span) ? [span] : [];
		}),
	);
	const suggestions = plan.suggestions.filter((suggestion) => {
		if (suggestion.reason === "speech") return false;
		if (
			(suggestion.reason === "silent-static" || suggestion.reason === "silent-moving") &&
			(suggestion.kind === "trim" || suggestion.kind === "speed") &&
			projections.some((span) => overlaps(span, suggestion))
		) {
			warnings.add("speech-protects-audio");
			return false;
		}
		return true;
	});
	for (const cue of transcript.cues) {
		if (!state.clipRegions.some((clip) => projectWholeCue(cue, clip))) continue;
		if (state.autoCaptions.some((existing) => overlaps(existing, cue))) continue;
		const next: EditSuggestion = {
			id: `speech-caption-${cue.id}`,
			kind: "caption",
			reason: "speech",
			startMs: cue.startMs,
			endMs: cue.endMs,
			text: cue.text,
			cue: {
				...cue,
				...(cue.words ? { words: cue.words.map((word) => ({ ...word })) } : {}),
			},
			...(!transcript.alignmentVerified ? { blocked: "speech-audio-unverified" } : {}),
		};
		suggestions.push(next);
	}
	const allRemoved = analysis.cuts.flatMap((cut) => {
		if (!cut || !Array.isArray(cut.removeCueIds) || !Array.isArray(cut.keepCueIds))
			throw Error("Invalid speech cuts");
		return cut.removeCueIds;
	});
	for (const [index, cut] of analysis.cuts.entries()) {
		const issue = speechCutIssue(cut, transcript);
		if (issue && issue !== "speech-confidence-unverified") {
			warnings.add(issue);
			continue;
		}
		if (
			cut.keepCueIds.some((id) => allRemoved.includes(id)) ||
			cut.removeCueIds.some(
				(id) => allRemoved.filter((candidate) => candidate === id).length > 1,
			)
		) {
			warnings.add("speech-conflicting-cuts");
			continue;
		}
		const keepCues = cut.keepCueIds.map((id) => byId.get(id)!);
		// Keep the complete replacement in one intact clip, in its spoken order.
		// Separate retained fragments may have been reordered into a different sentence.
		const keepSpan = { ...keepCues[0], endMs: keepCues[keepCues.length - 1].endMs };
		const keptTakes = state.clipRegions.flatMap((clip) => {
			const projected = projectWholeCue(keepSpan, clip);
			return projected &&
				!suggestions.some(
					(s) => (s.kind === "trim" || s.kind === "speed") && overlaps(s, projected),
				)
				? [projected]
				: [];
		});
		if (!keptTakes.length) {
			warnings.add("speech-kept-take-missing");
			continue;
		}
		for (const id of cut.removeCueIds) {
			const cue = byId.get(id)!;
			for (const clip of state.clipRegions) {
				const span = projectWholeCue(cue, clip);
				if (!span) continue;
				if (!keptTakes.some((keep) => keep.startMs >= span.endMs)) {
					warnings.add("speech-kept-take-missing");
					continue;
				}
				if (
					suggestions.some(
						(s) => (s.kind === "trim" || s.kind === "speed") && overlaps(s, span),
					)
				) {
					warnings.add("speech-conflicting-cuts");
					continue;
				}
				const next: EditSuggestion = {
					...span,
					id: `speech-trim-${index}-${clip.id}-${id}`,
					kind: "trim",
					reason: "speech",
					text: `${cue.text} → ${keepCues.map((keep) => keep.text).join(" ")}`,
				};
				suggestions.push({ ...next, blocked: issue ?? conflictFor(next, state) });
			}
		}
	}
	// Pauses between VAD-verified phrases. Padding keeps the cut sounding natural.
	if (transcript.audioVerified) {
		const ordered = [...transcript.cues].sort((a, b) => a.startMs - b.startMs);
		for (let i = 1; i < ordered.length; i++) {
			const before = ordered[i - 1],
				after = ordered[i];
			if (!before.vadBoundaryVerified || !after.vadBoundaryVerified) continue;
			if (allRemoved.includes(before.id) || allRemoved.includes(after.id)) continue;
			const gap = { startMs: before.endMs + 300, endMs: after.startMs - 300 };
			if (gap.endMs - gap.startMs < 700) continue;
			if (ordered.some((cue) => overlaps(cue, gap))) continue;
			if (
				(context.cursor ?? []).some(
					(point) =>
						point.interactionType &&
						point.interactionType !== "move" &&
						point.timeMs >= gap.startMs - 300 &&
						point.timeMs <= gap.endMs + 300,
				)
			)
				continue;
			const frozen = (context.staticRanges ?? []).some(
				(range) => range.startMs <= gap.startMs && range.endMs >= gap.endMs,
			);
			for (const clip of state.clipRegions) {
				const span = projectWholeCue(gap, clip);
				if (!span) continue;
				if (
					suggestions.some(
						(existing) =>
							(existing.kind === "trim" || existing.kind === "speed") &&
							overlaps(existing, span),
					)
				)
					continue;
				const next: EditSuggestion = {
					...span,
					id: `speech-pause-${clip.id}-${before.id}`,
					reason: "speech-pause",
					...(frozen ? { kind: "trim" as const } : { kind: "speed" as const, speed: 2 }),
				};
				suggestions.push({ ...next, blocked: conflictFor(next, state) });
			}
		}
	}
	return {
		...plan,
		suggestions,
		warnings: [...warnings],
		reviewer: "local-ai",
		speechAnalysis: analysis,
	};
}
