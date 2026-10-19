import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	ZoomRegion,
} from "../types";
import { getClipSourceStartMs } from "../types";

export interface Span {
	startMs: number;
	endMs: number;
}
export interface MediaEvidence {
	durationMs: number;
	staticRanges: Span[];
	silentRanges: Span[];
	audioVerified: boolean;
	warnings: string[];
}
export interface EditState {
	additionalVisualSource?: string | null;
	sourceAudioTrackSettingsByClip?: Record<
		string,
		import("../audio/audioTypes").SourceAudioTrackSettings
	>;
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	speedRegions: SpeedRegion[];
}
export type ConflictReason =
	| "webcam-alignment-unverified"
	| "legacy-speed"
	| "existing-edit"
	| "existing-speed"
	| "existing-zoom"
	| "existing-annotation"
	| "speech-invalid-grounding"
	| "speech-audio-unverified"
	| "speech-asr-uncertain"
	| "speech-vad-unverified"
	| "speech-overlapping-speech"
	| "speech-unique-content"
	| "speech-confidence-unverified";
export interface EditSuggestion extends Span {
	id: string;
	kind: "trim" | "zoom" | "speed" | "annotation" | "caption";
	reason: "silent-static" | "click" | "transcript" | "vision" | "speech" | "speech-pause";
	cue?: CaptionCue;
	focus?: { cx: number; cy: number };
	depth?: 1 | 2 | 3;
	speed?: number;
	text?: string;
	blocked?: ConflictReason;
}
export interface EditPlan {
	version: 1;
	id: string;
	coordinateSpace: "timeline-ms";
	baseline: string;
	suggestions: EditSuggestion[];
	warnings: string[];
	reviewer: "rules" | "local-ai";
	visualAnalysis?: import("./vision").VisualAnalysis;
	speechAnalysis?: import("./speechTypes").SpeechAnalysis;
}
export type Decision = "pending" | "accept" | "reject";
export const overlaps = (a: Span, b: Span) => a.startMs < b.endMs && b.startMs < a.endMs;
export const validSpan = (s: Span) =>
	Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.startMs >= 0 && s.endMs > s.startMs;
export const baselineFor = (state: EditState, source: string) =>
	JSON.stringify({
		source,
		additionalVisualSource: state.additionalVisualSource ?? null,
		clipRegions: state.clipRegions,
		zoomRegions: state.zoomRegions,
		annotationRegions: state.annotationRegions,
		audioRegions: state.audioRegions,
		autoCaptions: state.autoCaptions,
		speedRegions: state.speedRegions,
		sourceAudioTrackSettingsByClip: state.sourceAudioTrackSettingsByClip ?? {},
	});

export function intersectRanges(a: Span[], b: Span[]): Span[] {
	return a
		.flatMap((left) =>
			b.flatMap((right) => {
				const span = {
					startMs: Math.max(left.startMs, right.startMs),
					endMs: Math.min(left.endMs, right.endMs),
				};
				return validSpan(span) ? [span] : [];
			}),
		)
		.sort((x, y) => x.startMs - y.startMs);
}

export function conflictFor(s: EditSuggestion, state: EditState): ConflictReason | undefined {
	if (s.kind === "trim" || s.kind === "speed") {
		if (state.additionalVisualSource) return "webcam-alignment-unverified";
		if (state.speedRegions.length) return "legacy-speed";
		if (
			[...state.zoomRegions, ...state.annotationRegions, ...state.audioRegions].some((r) =>
				overlaps(s, r),
			)
		)
			return "existing-edit";
		if (state.clipRegions.some((c) => overlaps(s, c) && c.speed !== 1)) return "existing-speed";
	}
	if (s.kind === "zoom" && state.zoomRegions.some((r) => overlaps(s, r))) return "existing-zoom";
	if (s.kind === "annotation" && state.annotationRegions.some((r) => overlaps(s, r)))
		return "existing-annotation";
	return undefined;
}

/** Evidence is in source coordinates; authored clips may be reordered, repeated or sped up. */
export function buildEditPlan(input: {
	state: EditState;
	source: string;
	evidence: MediaEvidence;
	cursor: CursorTelemetryPoint[];
	id: string;
}): EditPlan {
	const { state, source, evidence, cursor, id } = input;
	const suggestions: EditSuggestion[] = [];
	const add = (s: Omit<EditSuggestion, "id">) => {
		if (!validSpan(s)) return;
		const suggestion = { ...s, id: `suggestion-${suggestions.length + 1}` };
		suggestions.push({ ...suggestion, blocked: conflictFor(suggestion, state) });
	};
	for (const clip of state.clipRegions) {
		const sourceStart = getClipSourceStartMs(clip);
		const sourceEnd = sourceStart + (clip.endMs - clip.startMs) * clip.speed;
		const project = (s: Span) => ({
			startMs: Math.round(clip.startMs + (s.startMs - sourceStart) / clip.speed),
			endMs: Math.round(clip.startMs + (s.endMs - sourceStart) / clip.speed),
		});
		if (evidence.audioVerified && !state.additionalVisualSource) {
			const quiet = intersectRanges(
				intersectRanges(evidence.staticRanges, evidence.silentRanges),
				[{ startMs: sourceStart, endMs: sourceEnd }],
			);
			for (const range of quiet) {
				// No text interpretation: every supplied cue protects speech in every language.
				if (
					state.autoCaptions.some((c) =>
						overlaps({ startMs: c.startMs - 400, endMs: c.endMs + 400 }, range),
					)
				)
					continue;
				if (
					cursor.some(
						(c) =>
							c.interactionType &&
							c.interactionType !== "move" &&
							c.timeMs >= range.startMs - 400 &&
							c.timeMs <= range.endMs + 400,
					)
				)
					continue;
				const padded = project({ startMs: range.startMs + 400, endMs: range.endMs - 400 });
				if (padded.endMs - padded.startMs < 1000) continue;
				const kind = padded.endMs - padded.startMs >= 2500 ? "trim" : "speed";
				// Always retain at least 400 ms at clip boundaries, even for all-static recordings.
				add({
					...padded,
					kind,
					reason: "silent-static",
					...(kind === "speed" ? { speed: 1.5 } : {}),
				});
			}
		}
		let lastClick = -Infinity;
		for (const click of [...cursor].sort((a, b) => a.timeMs - b.timeMs)) {
			if (
				!["click", "double-click", "right-click", "middle-click"].includes(
					click.interactionType ?? "",
				)
			)
				continue;
			if (
				!Number.isFinite(click.cx) ||
				!Number.isFinite(click.cy) ||
				click.timeMs < sourceStart ||
				click.timeMs >= sourceEnd ||
				click.timeMs - lastClick < 2000
			)
				continue;
			lastClick = click.timeMs;
			add({
				...project({
					startMs: Math.max(sourceStart, click.timeMs - 350),
					endMs: Math.min(sourceEnd, click.timeMs + 1500),
				}),
				kind: "zoom",
				reason: "click",
				depth: 2,
				focus: {
					cx: Math.max(0, Math.min(1, click.cx)),
					cy: Math.max(0, Math.min(1, click.cy)),
				},
			});
		}
		for (const cue of state.autoCaptions) {
			if (!cue.text.trim() || !validSpan(cue)) continue;
			const startMs = Math.max(sourceStart, cue.startMs),
				endMs = Math.min(sourceEnd, cue.endMs);
			if (endMs > startMs)
				add({
					...project({ startMs, endMs }),
					kind: "annotation",
					reason: "transcript",
					text: cue.text,
				});
		}
	}
	return {
		version: 1,
		id,
		coordinateSpace: "timeline-ms",
		baseline: baselineFor(state, source),
		suggestions,
		warnings: [
			...evidence.warnings,
			...(!evidence.audioVerified ? ["audio-unverified"] : []),
			...(state.additionalVisualSource ? ["webcam-alignment-unverified"] : []),
		],
		reviewer: "rules",
	};
}

/** AI is allowed only to remove or narrow rule candidates. It cannot invent edits or change text. */
export function mergeLocalReview(plan: EditPlan, raw: unknown): EditPlan {
	if (!Array.isArray(raw) || raw.length > plan.suggestions.length)
		throw new Error("Invalid AI review");
	const seen = new Set<string>();
	const suggestions = raw.map((value: unknown) => {
		if (!value || typeof value !== "object") throw new Error("Invalid AI review");
		const patch = value as Record<string, unknown>;
		const original = plan.suggestions.find((s) => s.id === patch.id);
		if (!original || seen.has(original.id)) throw new Error("Unknown or duplicate suggestion");
		seen.add(original.id);
		const next = {
			...original,
			startMs: patch.startMs as number,
			endMs: patch.endMs as number,
		};
		if (!validSpan(next) || next.startMs < original.startMs || next.endMs > original.endMs)
			throw new Error("AI expanded rule evidence");
		return next;
	});
	return { ...plan, suggestions, reviewer: "local-ai" };
}
