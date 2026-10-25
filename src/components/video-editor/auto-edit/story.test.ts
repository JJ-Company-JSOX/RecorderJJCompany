import { expect, it } from "vitest";
import { emptyStoryBrief, isStoryRequest, storyScenes } from "./story";
it("covers a short video once without duplicate intro and outro", () => {
	expect(storyScenes([{ id: "a", startMs: 0, endMs: 4100, speed: 1 }])).toEqual([
		{ id: "story-1", startMs: 0, endMs: 4100, sourceTimeMs: 2050 },
	]);
});
it("uses source time after a cut, reorder and speed change without narrating gaps", () => {
	const scenes = storyScenes([
		{ id: "b", startMs: 20000, endMs: 50000, sourceStartMs: 1000, speed: 2 },
		{ id: "a", startMs: 0, endMs: 10000, sourceStartMs: 60000, speed: 1 },
	]);
	expect(scenes[0].sourceTimeMs).toBe(65000);
	for (const s of scenes.slice(1)) {
		expect(s.startMs).toBeGreaterThanOrEqual(20000);
		expect(s.sourceTimeMs).toBe(1000 + ((s.startMs + s.endMs) / 2 - 20000) * 2);
	}
	expect(scenes).toHaveLength(5);
});
it("bounds large mixed timelines to eight real footage spans", () => {
	const scenes = storyScenes(
		Array.from({ length: 30 }, (_, i) => ({
			id: `c${i}`,
			startMs: i * 10000,
			endMs: i * 10000 + 5000,
			speed: 1,
		})),
	);
	expect(scenes).toHaveLength(8);
	for (const s of scenes) expect(s.endMs - s.startMs).toBe(5000);
});
it("validates the IPC boundary instead of accepting arbitrary timing or unbounded briefs", () => {
	const r = {
		brief: { ...emptyStoryBrief(), topic: "My product" },
		videoPath: "test.mp4",
		scenes: storyScenes([{ id: "a", startMs: 0, endMs: 10000, speed: 1 }]),
	};
	expect(isStoryRequest(r)).toBe(true);
	for (const patch of [
		{ brief: null },
		{ scenes: [{ id: "x", startMs: 0, endMs: 100, sourceTimeMs: 0 }] },
		{ brief: { ...r.brief, notes: "x".repeat(2001) } },
		{ scenes: [{ ...r.scenes[0], sourceTimeMs: -1 }] },
	])
		expect(isStoryRequest({ ...r, ...patch })).toBe(false);
});

it("rejects story timing in gaps or overlaps and keeps fitted audio in its scene", async () => {
	const { validStoryTiming, placeStoryAudio } = await import("./story");
	const clips = [{ id: "c", startMs: 0, endMs: 10000, speed: 1 }];
	const cues = [
		{ id: "story-1", startMs: 0, endMs: 4000 },
		{ id: "story-2", startMs: 5000, endMs: 10000 },
	];
	expect(validStoryTiming(cues, clips)).toBe(true);
	expect(
		validStoryTiming(
			[
				{ startMs: 0, endMs: 6000 },
				{ startMs: 5000, endMs: 10000 },
			],
			clips,
		),
	).toBe(false);
	expect(validStoryTiming([{ startMs: 8000, endMs: 12000 }], clips)).toBe(false);
	expect(placeStoryAudio([{ id: "story-2", durationMs: 1000 }], cues).placed[0]).toMatchObject({
		startMs: 5000,
		endMs: 6000,
	});
	expect(() => placeStoryAudio([{ id: "story-1", durationMs: 5000 }], cues)).toThrow("story-1");
});

it("requires transcript consent and validates bounded timeline-aligned subtitle evidence", () => {
	const r = {
		brief: { ...emptyStoryBrief(), topic: "Product", includeTranscript: true },
		videoPath: "test.mp4",
		scenes: [{ id: "story-1", startMs: 0, endMs: 10000, sourceTimeMs: 5000 }],
		transcript: [{ startMs: 100, endMs: 200, text: "Edited subtitle" }],
	};
	expect(isStoryRequest(r)).toBe(true);
	for (const patch of [
		{ brief: { ...r.brief, includeTranscript: false } },
		{ transcript: [{ startMs: -1, endMs: 200, text: "Invalid" }] },
		{ transcript: [{ startMs: 11000, endMs: 12000, text: "Outside the current story" }] },
		{ transcript: Array.from({ length: 81 }, () => r.transcript[0]) },
		{ transcript: [{ startMs: 100, endMs: 200, text: "x".repeat(501) }] },
		{
			transcript: Array.from({ length: 7 }, () => ({
				startMs: 100,
				endMs: 200,
				text: "x".repeat(500),
			})),
		},
		{
			brief: {
				...r.brief,
				facts: "x".repeat(2000),
				notes: "x".repeat(2000),
				ending: "x".repeat(2000),
			},
		},
	])
		expect(isStoryRequest({ ...r, ...patch })).toBe(false);
});

it("rejects subtitle evidence crossing a gap in the selected story footage", () => {
	expect(
		isStoryRequest({
			brief: { ...emptyStoryBrief(), topic: "Product", includeTranscript: true },
			videoPath: "test.mp4",
			scenes: [
				{ id: "story-1", startMs: 0, endMs: 1000, sourceTimeMs: 500 },
				{ id: "story-2", startMs: 2000, endMs: 3000, sourceTimeMs: 2500 },
			],
			transcript: [{ startMs: 500, endMs: 2500, text: "Includes a removed middle section" }],
		}),
	).toBe(false);
});

it("uses a conservative smaller aggregate text budget when video frames share model context", () => {
	const r = {
		brief: { ...emptyStoryBrief(), topic: "Product", facts: "x".repeat(1993) },
		videoPath: "test.mp4",
		scenes: [{ id: "story-1", startMs: 0, endMs: 10000, sourceTimeMs: 5000 }],
	};
	expect(isStoryRequest(r)).toBe(true);
	expect(isStoryRequest({ ...r, brief: { ...r.brief, notes: "x" } })).toBe(false);
	const textOnly = {
		...r,
		brief: {
			...r.brief,
			analyzeVideo: false,
			facts: "x".repeat(2000),
			notes: "x".repeat(1993),
		},
	};
	expect(isStoryRequest(textOnly)).toBe(true);
	expect(isStoryRequest({ ...textOnly, brief: { ...textOnly.brief, ending: "x" } })).toBe(false);
	expect(
		isStoryRequest({
			...r,
			brief: { ...r.brief, includeTranscript: true },
			transcript: [{ startMs: 0, endMs: 1000, text: "x" }],
		}),
	).toBe(false);
});
