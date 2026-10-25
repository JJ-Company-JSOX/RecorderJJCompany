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
