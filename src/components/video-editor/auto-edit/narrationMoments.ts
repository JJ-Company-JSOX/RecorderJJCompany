import { type CursorTelemetryPoint, getClipSourceStartMs, sortClipRegions } from "../types";
import type { EditState, EditSuggestion } from "./plan";

/** Lines closer together than this would talk over each other. */
export const MIN_NARRATION_GAP_MS = 4000;
const EVEN_SPACING_MS = 8000;
const MAX_MOMENTS = 16;
const CLICKS = new Set(["click", "double-click", "right-click", "middle-click"]);

/**
 * The moments AI voice-over describes, in timeline time: zooms (Recordly's own or AI's),
 * clicks without a zoom, and sped-up parts. A recording with none of these, such as a
 * silent screen recording with no clicks, gets evenly spaced moments instead, so every
 * video can be narrated from what the screen shows.
 */
export function narrationMoments(
	state: EditState,
	cursor: CursorTelemetryPoint[],
): EditSuggestion[] {
	const clips = sortClipRegions(state.clipRegions);
	const durationMs = Math.max(0, ...clips.map((c) => c.endMs));
	if (!durationMs) return [];
	const candidates: EditSuggestion[] = [
		...state.zoomRegions.map((z, i) => ({
			id: `zoom-${i + 1}`,
			kind: "zoom" as const,
			reason: "click" as const,
			startMs: z.startMs,
			endMs: z.endMs,
			focus: z.focus,
		})),
		...clips
			.filter((c) => c.speed > 1)
			.map((c, i) => ({
				id: `speed-${i + 1}`,
				kind: "speed" as const,
				reason: "silent-moving" as const,
				startMs: c.startMs,
				endMs: c.endMs,
				speed: c.speed,
			})),
	];
	let clickIndex = 0;
	for (const point of cursor) {
		if (!CLICKS.has(point.interactionType ?? "")) continue;
		if (!Number.isFinite(point.cx) || !Number.isFinite(point.cy)) continue;
		const clip = clips.find((c) => {
			const start = getClipSourceStartMs(c);
			return point.timeMs >= start && point.timeMs < start + (c.endMs - c.startMs) * c.speed;
		});
		if (!clip) continue;
		const timeMs = Math.round(
			clip.startMs + (point.timeMs - getClipSourceStartMs(clip)) / clip.speed,
		);
		if (state.zoomRegions.some((z) => timeMs >= z.startMs && timeMs < z.endMs)) continue;
		candidates.push({
			id: `click-${++clickIndex}`,
			kind: "caption",
			reason: "click",
			startMs: timeMs,
			endMs: Math.min(durationMs, timeMs + 1500),
			focus: {
				cx: Math.max(0, Math.min(1, point.cx)),
				cy: Math.max(0, Math.min(1, point.cy)),
			},
		});
	}
	const moments: EditSuggestion[] = [];
	for (const candidate of candidates.sort((a, b) => a.startMs - b.startMs)) {
		const previous = moments[moments.length - 1];
		if (previous && candidate.startMs - previous.startMs < MIN_NARRATION_GAP_MS) continue;
		moments.push(candidate);
		if (moments.length === MAX_MOMENTS) break;
	}
	if (moments.length) return moments;
	const count = Math.max(1, Math.min(8, Math.floor(durationMs / EVEN_SPACING_MS)));
	return Array.from({ length: count }, (_, i) => {
		const startMs = Math.round(((i + 0.5) * durationMs) / count) - 500;
		return {
			id: `moment-${i + 1}`,
			kind: "caption" as const,
			reason: "vision" as const,
			startMs: Math.max(0, startMs),
			endMs: Math.min(durationMs, Math.max(0, startMs) + 1500),
		};
	});
}

/** Places voice clips in order so none starts before the previous one has finished. */
export function scheduleNarration<T extends { startMs: number; durationMs: number }>(
	clips: T[],
	gapMs = 250,
): (T & { endMs: number })[] {
	let free = 0;
	return [...clips]
		.sort((a, b) => a.startMs - b.startMs)
		.map((clip) => {
			const startMs = Math.max(clip.startMs, free);
			free = startMs + clip.durationMs + gapMs;
			return { ...clip, startMs, endMs: startMs + clip.durationMs };
		});
}
