import { expect, it } from "vitest";
import { emptyStoryBrief, isStoryRequest, storyScenes } from "./story";
it("starts fresh stories in text mode without enabling frame or speech processing", () => {
	expect(emptyStoryBrief()).toMatchObject({
		analyzeVideo: false,
		includeTranscript: false,
		autoTranscribe: false,
	});
});
it("preserves explicit saved frame-analysis choices when a story workspace is restored", async () => {
	const { emptyStoryWorkspace, normalizeStoryWorkspace } = await import("./storyWorkspace");
	for (const analyzeVideo of [true, false]) {
		const saved = emptyStoryWorkspace();
		saved.brief.analyzeVideo = analyzeVideo;
		expect(normalizeStoryWorkspace(saved)?.brief.analyzeVideo).toBe(analyzeVideo);
	}
});
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
		brief: {
			...emptyStoryBrief(),
			analyzeVideo: true,
			topic: "Product",
			facts: "x".repeat(1993),
		},
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

it("validates narration target as optional whole seconds five to six hundred", () => {
	const request = {
		brief: { ...emptyStoryBrief(), topic: "Product" },
		videoPath: "test.mp4",
		scenes: [{ id: "story-1", startMs: 0, endMs: 10000, sourceTimeMs: 5000 }],
	};
	for (const value of [undefined, 5, 30, 600])
		expect(
			isStoryRequest({ ...request, brief: { ...request.brief, targetSpeechSeconds: value } }),
		).toBe(true);
	for (const value of [null, "30", 0, 4, 601, 30.5, NaN, Infinity, -5])
		expect(
			isStoryRequest({ ...request, brief: { ...request.brief, targetSpeechSeconds: value } }),
		).toBe(false);
});
it("scales per-scene speech caps to the requested total without changing footage or adding shots", async () => {
	const { storySpeechBudget } = await import("./story");
	const scenes = [
		{ id: "story-1", startMs: 0, endMs: 20000, sourceTimeMs: 10000 },
		{ id: "story-2", startMs: 25000, endMs: 65000, sourceTimeMs: 45000 },
	];
	const original = JSON.stringify(scenes);
	const budget = storySpeechBudget({ targetSpeechSeconds: 30 }, scenes, "en");
	expect(budget).toMatchObject({ requestedSeconds: 30, footageSeconds: 60, budgetSeconds: 30 });
	expect(budget.slots.map((s) => s.speechSeconds)).toEqual([10, 20]);
	expect(budget.slots.map((s) => s.maxChars)).toEqual([110, 220]);
	expect(budget.slots.reduce((sum, s) => sum + s.maxChars, 0)).toBeLessThanOrEqual(30 * 11);
	expect(budget.slots.map((s) => [s.startMs, s.endMs])).toEqual([
		[0, 20000],
		[25000, 65000],
	]);
	expect(JSON.stringify(scenes)).toBe(original);
});
it("uses real scene coverage for short footage and follows footage when target is omitted", async () => {
	const { storySpeechBudget } = await import("./story");
	const scenes = [{ id: "story-1", startMs: 1000, endMs: 7000, sourceTimeMs: 4000 }];
	expect(storySpeechBudget({ targetSpeechSeconds: 30 }, scenes, "zh")).toMatchObject({
		requestedSeconds: 30,
		footageSeconds: 6,
		budgetSeconds: 6,
		slots: [{ startMs: 1000, endMs: 7000, speechSeconds: 6, maxChars: 21 }],
	});
	expect(storySpeechBudget({}, scenes, "en")).toMatchObject({
		requestedSeconds: null,
		budgetSeconds: 6,
		slots: [{ speechSeconds: 6, maxChars: 66 }],
	});
});
it("does not inflate a tiny requested speech budget with artificial per-scene minimums", async () => {
	const { storySpeechBudget } = await import("./story");
	const scenes = Array.from({ length: 8 }, (_, i) => ({
		id: `story-${i + 1}`,
		startMs: i * 10000,
		endMs: (i + 1) * 10000,
		sourceTimeMs: i * 10000 + 5000,
	}));
	const budget = storySpeechBudget({ targetSpeechSeconds: 5 }, scenes, "zh");
	expect(budget.slots.reduce((sum, s) => sum + s.maxChars, 0)).toBeLessThanOrEqual(
		Math.floor(5 * 3.5),
	);
	for (const slot of budget.slots) expect(slot.maxChars).toBe(2);
});

it("validates explicit auto-transcription intent without enabling it for legacy story briefs", () => {
	const r = {
		brief: { ...emptyStoryBrief(), topic: "Product" },
		videoPath: "test.mp4",
		scenes: [{ id: "story-1", startMs: 0, endMs: 10000, sourceTimeMs: 5000 }],
	};
	expect(emptyStoryBrief().autoTranscribe).toBe(false);
	for (const value of [undefined, false, true])
		expect(isStoryRequest({ ...r, brief: { ...r.brief, autoTranscribe: value } })).toBe(true);
	for (const value of [null, "true", 1])
		expect(isStoryRequest({ ...r, brief: { ...r.brief, autoTranscribe: value } })).toBe(false);
});
