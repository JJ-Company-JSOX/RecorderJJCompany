import { packClipSequence } from "../clipSequence";
import { type ClipRegion, DEFAULT_ANNOTATION_STYLE, getClipSourceStartMs } from "../types";
import {
	baselineFor,
	conflictFor,
	type Decision,
	type EditPlan,
	type EditState,
	type EditSuggestion,
	overlaps,
	validSpan,
} from "./plan";

/** Apply one explicit user transaction. Existing objects are never mutated. */
export function applyEditPlan(
	state: EditState,
	source: string,
	plan: EditPlan,
	decisions: Record<string, Decision>,
): EditState {
	if (baselineFor(state, source) !== plan.baseline) throw new Error("stale-plan");
	const accepted = plan.suggestions.filter((s) => decisions[s.id] === "accept");
	for (const s of accepted) {
		if (
			s.blocked ||
			conflictFor(s, state) ||
			!validSpan(s) ||
			(s.kind !== "caption" &&
				!state.clipRegions.some((c) => s.startMs >= c.startMs && s.endMs <= c.endMs))
		)
			throw new Error("conflicting-edit");
		if (s.kind === "speed" && (!s.speed || s.speed < 1 || s.speed > 2))
			throw new Error("invalid-speed");
		if (
			s.kind === "caption" &&
			(!s.cue ||
				!validSpan(s.cue) ||
				!s.cue.text.trim() ||
				s.cue.startMs !== s.startMs ||
				s.cue.endMs !== s.endMs)
		)
			throw new Error("invalid-caption");
	}
	const timing = accepted
		.filter((s) => s.kind === "trim" || s.kind === "speed")
		.sort((a, b) => a.startMs - b.startMs);
	if (timing.some((s, i) => timing.slice(i + 1).some((t) => overlaps(s, t))))
		throw new Error("overlapping-edits");
	const mapTime = (time: number) =>
		Math.round(
			timing.reduce((result, s) => {
				const covered = Math.max(0, Math.min(time, s.endMs) - s.startMs);
				return result - covered * (s.kind === "trim" ? 1 : 1 - 1 / s.speed!);
			}, time),
		);
	const clips: ClipRegion[] = [];
	for (const clip of state.clipRegions) {
		const changes = timing.filter((s) => overlaps(s, clip));
		if (!changes.length) {
			clips.push({ ...clip });
			continue;
		}
		const boundaries = [
			...new Set([clip.startMs, clip.endMs, ...changes.flatMap((s) => [s.startMs, s.endMs])]),
		].sort((a, b) => a - b);
		for (let i = 0; i < boundaries.length - 1; i++) {
			const start = boundaries[i],
				end = boundaries[i + 1];
			const edit = changes.find((s) => start >= s.startMs && end <= s.endMs);
			if (edit?.kind === "trim") continue;
			clips.push({
				...clip,
				id: clips.some((c) => c.id === clip.id)
					? `${clip.id}-auto-${plan.id}-${i}`
					: clip.id,
				sourceStartMs: getClipSourceStartMs(clip) + (start - clip.startMs) * clip.speed,
				startMs: mapTime(start),
				endMs: mapTime(end),
				speed: edit?.kind === "speed" ? clip.speed * edit.speed! : clip.speed,
			});
		}
	}
	if (!clips.length) throw new Error("empty-timeline");
	const remap = <T extends { startMs: number; endMs: number }>(regions: T[]) =>
		regions.map((r) => ({ ...r, startMs: mapTime(r.startMs), endMs: mapTime(r.endMs) }));
	// Only subtitle-line cuts may run over zooms and labels; drop any they squeeze to nothing.
	const visible = <T extends { startMs: number; endMs: number }>(regions: T[]) =>
		regions.filter((r) => r.endMs - r.startMs >= 100);
	const zoomRegions = visible(remap(state.zoomRegions));
	const annotationRegions = visible(remap(state.annotationRegions));
	const autoCaptions = [...state.autoCaptions];
	const idFor = (s: EditSuggestion) => `auto-${plan.id}-${s.id}`;
	for (const s of accepted) {
		if (s.kind === "caption" && s.cue && !autoCaptions.some((c) => c.id === s.cue!.id))
			autoCaptions.push({ ...s.cue, words: s.cue.words?.map((word) => ({ ...word })) });
		if (s.kind === "zoom" && s.focus && s.depth) {
			const next = {
				id: idFor(s),
				startMs: mapTime(s.startMs),
				endMs: mapTime(s.endMs),
				depth: s.depth,
				focus: s.focus,
				mode: "manual" as const,
			};
			if (!validSpan(next)) continue;
			if (zoomRegions.some((r) => overlaps(r, next))) throw new Error("conflicting-edit");
			zoomRegions.push(next);
		}
		if (s.kind === "annotation" && s.text && mapTime(s.endMs) > mapTime(s.startMs))
			annotationRegions.push({
				id: idFor(s),
				startMs: mapTime(s.startMs),
				endMs: mapTime(s.endMs),
				type: "text",
				content: s.text,
				textContent: s.text,
				position: { x: 20, y: 65 },
				size: { width: 60, height: 15 },
				style: { ...DEFAULT_ANNOTATION_STYLE, backgroundColor: "#111827E6" },
				zIndex: Math.max(0, ...annotationRegions.map((a) => a.zIndex)) + 1,
				trackIndex: Math.max(-1, ...annotationRegions.map((a) => a.trackIndex ?? 0)) + 1,
			});
	}
	return {
		...state,
		clipRegions: packClipSequence(clips),
		zoomRegions,
		annotationRegions,
		autoCaptions,
		audioRegions: remap(state.audioRegions),
	};
}
