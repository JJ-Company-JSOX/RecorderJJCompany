import { getClipSourceStartMs, sortClipRegions, type ClipRegion } from "../types";
export interface StoryBrief {
	topic: string;
	audience: string;
	facts: string;
	ending: string;
	notes: string;
	analyzeVideo: boolean;
}
export interface StoryScene {
	id: string;
	startMs: number;
	endMs: number;
	sourceTimeMs: number;
}
export interface StoryRequest {
	brief: StoryBrief;
	scenes: StoryScene[];
	videoPath: string;
	style?: "concise" | "tutorial" | "detailed";
}
export const emptyStoryBrief = (): StoryBrief => ({
	topic: "",
	audience: "",
	facts: "",
	ending: "",
	notes: "",
	analyzeVideo: true,
});
export function isStoryRequest(value: unknown): value is StoryRequest {
	if (!value || typeof value !== "object") return false;
	const v = value as StoryRequest,
		b = v.brief;
	if (
		!b ||
		(v.style !== undefined && !["concise", "tutorial", "detailed"].includes(v.style)) ||
		typeof b.analyzeVideo !== "boolean" ||
		![b.topic, b.audience, b.facts, b.ending, b.notes].every(
			(t) => typeof t === "string" && t.length <= 2000,
		) ||
		!b.topic.trim() ||
		typeof v.videoPath !== "string" ||
		v.videoPath.length > 4096 ||
		!Array.isArray(v.scenes) ||
		!v.scenes.length ||
		v.scenes.length > 8
	)
		return false;
	return v.scenes.every(
		(s, i) =>
			s &&
			s.id === `story-${i + 1}` &&
			[s.startMs, s.endMs, s.sourceTimeMs].every(
				(t) => Number.isFinite(t) && t >= 0 && t <= 86400000,
			) &&
			s.endMs > s.startMs &&
			(i === 0 || s.startMs >= v.scenes[i - 1].endMs),
	);
}
/** Up to eight real clip spans, evenly covering kept footage; no invented moments in gaps. */
export function storyScenes(clips: ClipRegion[]): StoryScene[] {
	const sorted = sortClipRegions(clips).filter((c) => c.endMs > c.startMs && c.speed > 0);
	const duration = sorted.reduce((sum, c) => sum + c.endMs - c.startMs, 0);
	if (!duration) return [];
	const count = Math.min(8, Math.max(1, Math.floor(duration / 8000)));
	const spans = sorted.flatMap((c) => {
		const parts = Math.max(1, Math.round(((c.endMs - c.startMs) / duration) * count));
		return Array.from({ length: parts }, (_, i) => ({
			startMs: Math.round(c.startMs + ((c.endMs - c.startMs) * i) / parts),
			endMs: Math.round(c.startMs + ((c.endMs - c.startMs) * (i + 1)) / parts),
			sourceTimeMs: Math.round(
				getClipSourceStartMs(c) + (((c.endMs - c.startMs) * (i + 0.5)) / parts) * c.speed,
			),
		}));
	});
	const selected =
		spans.length <= 8
			? spans
			: Array.from(
					{ length: 8 },
					(_, i) => spans[Math.floor(((i + 0.5) * spans.length) / 8)],
				);
	return selected.map((s, i) => ({ ...s, id: `story-${i + 1}` }));
}

export function validStoryTiming(
	cues: { startMs: number; endMs: number }[],
	clips: ClipRegion[],
): boolean {
	const ordered = [...cues].sort((a, b) => a.startMs - b.startMs);
	return ordered.every(
		(c, i) =>
			Number.isFinite(c.startMs) &&
			Number.isFinite(c.endMs) &&
			c.startMs >= 0 &&
			c.endMs > c.startMs &&
			(i === 0 || c.startMs >= ordered[i - 1].endMs) &&
			clips.some((clip) => c.startMs >= clip.startMs && c.endMs <= clip.endMs),
	);
}
/** A story voice stays in its approved scene. Never silently move it to a different shot. */
export function placeStoryAudio<T extends { id: string; durationMs: number }>(
	clips: T[],
	cues: { id: string; startMs: number; endMs: number }[],
): { placed: (T & { startMs: number; endMs: number })[]; dropped: T[] } {
	return {
		placed: clips.map((clip) => {
			const cue = cues.find((c) => c.id === clip.id);
			if (
				!cue ||
				!Number.isFinite(clip.durationMs) ||
				clip.durationMs <= 0 ||
				clip.durationMs > cue.endMs - cue.startMs
			)
				throw Error(clip.id);
			return { ...clip, startMs: cue.startMs, endMs: cue.startMs + clip.durationMs };
		}),
		dropped: [],
	};
}
