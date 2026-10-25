import { expect, it } from "vitest";
import type { CaptionCue } from "@/components/video-editor/types";
import { captionRenderConfig } from "./captionProjection";

it("projects bound captions and word timings only into the intended edited occurrence", () => {
	const clips = [
		{ id: "a", startMs: 0, endMs: 2000, sourceStartMs: 1000, speed: 2 },
		{ id: "b", startMs: 4000, endMs: 8000, sourceStartMs: 1000, speed: 1 },
	];
	const cues: CaptionCue[] = [
		{
			id: "narration-a",
			clipId: "a",
			startMs: 2000,
			endMs: 4000,
			text: "First story",
			words: [
				{ text: "First", startMs: 1500, endMs: 2500 },
				{ text: "story", startMs: 3000, endMs: 4500 },
			],
		},
		{ id: "narration-b", clipId: "b", startMs: 2000, endMs: 4000, text: "Second story" },
	];
	const result = captionRenderConfig(cues, clips);
	expect(result.captionCoordinateSpace).toBe("timeline");
	expect(result.autoCaptions?.map((c) => [c.text, c.startMs, c.endMs])).toEqual([
		["First story", 500, 1500],
		["Second story", 5000, 7000],
	]);
	expect(result.autoCaptions?.[0].words).toEqual([
		{ text: "First", startMs: 500, endMs: 750 },
		{ text: "story", startMs: 1000, endMs: 1500 },
	]);
	expect(cues[0].words?.[0].startMs).toBe(1500);
});
it("preserves legacy source captions and explicitly empty edited timelines", () => {
	const cues = [{ id: "legacy", startMs: 1000, endMs: 2000, text: "Speech" }];
	expect(captionRenderConfig(cues, undefined)).toEqual({
		autoCaptions: cues,
		captionCoordinateSpace: "source",
	});
	expect(captionRenderConfig(cues, [])).toEqual({
		autoCaptions: [],
		captionCoordinateSpace: "timeline",
	});
});
it("preserves source-wide speech captions at both uses of repeated footage", () => {
	const clips = [
		{ id: "a", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
		{ id: "b", startMs: 2000, endMs: 4000, sourceStartMs: 0, speed: 1 },
	];
	expect(
		captionRenderConfig(
			[{ id: "speech", startMs: 100, endMs: 300, text: "Original speech" }],
			clips,
		).autoCaptions?.map((c) => [c.startMs, c.endMs]),
	).toEqual([
		[100, 300],
		[2100, 2300],
	]);
});
