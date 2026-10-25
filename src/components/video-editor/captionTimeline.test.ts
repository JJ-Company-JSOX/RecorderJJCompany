import { describe, expect, it } from "vitest";
import { captionSpanToSource, projectCaptionCues, retimeCaptionFragment } from "./captionTimeline";

const clips = [
	{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 3 },
	{ id: "b", startMs: 2000, endMs: 3000, sourceStartMs: 6000, speed: 3 },
];
describe("caption timeline projection", () => {
	it("omits deleted captions and splits crossing cues around gaps with distinct identities", () => {
		const fragments = projectCaptionCues(
			[
				{ id: "deleted", startMs: 3100, endMs: 5900, text: "gone" },
				{ id: "crossing", startMs: 1500, endMs: 7500, text: "kept" },
			],
			clips,
		);
		expect(
			fragments.map(({ sourceCueId, startMs, endMs }) => ({ sourceCueId, startMs, endMs })),
		).toEqual([
			{ sourceCueId: "crossing", startMs: 500, endMs: 1000 },
			{ sourceCueId: "crossing", startMs: 2000, endMs: 2500 },
		]);
		expect(new Set(fragments.map(({ id }) => id)).size).toBe(2);
	});
	it("projects reused footage at every timeline position", () => {
		const cue = { id: "cue", startMs: 0, endMs: 1500, text: "hello" };
		const fragments = projectCaptionCues([cue], [clips[0], { ...clips[1], sourceStartMs: 0 }]);
		expect(fragments.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
			[0, 500],
			[2000, 2500],
		]);
		expect(projectCaptionCues([cue], [])).toEqual([]);
	});
	it("retimes within the selected clip even at its cut boundary", () => {
		expect(captionSpanToSource(clips[0], { start: 500, end: 1000 })).toEqual({
			startMs: 1500,
			endMs: 3000,
		});
		expect(captionSpanToSource(clips[1], { start: 2000, end: 4000 })).toEqual({
			startMs: 6000,
			endMs: 9000,
		});
	});
	it("preserves the other fragment when resizing one edge of a crossing cue", () => {
		const fragments = projectCaptionCues(
			[{ id: "cue", startMs: 1500, endMs: 7500, text: "hello" }],
			clips,
		);
		expect(retimeCaptionFragment(fragments[0], { start: 600, end: 1000 })).toEqual({
			startMs: 1800,
			endMs: 7500,
		});
		expect(retimeCaptionFragment(fragments[1], { start: 2000, end: 2600 })).toEqual({
			startMs: 1500,
			endMs: 7800,
		});
	});
});

it("keeps generated captions on one occurrence while source speech follows reused footage", () => {
	const reused = [
		{ id: "first", startMs: 0, endMs: 4000, sourceStartMs: 0, speed: 1 },
		{ id: "second", startMs: 4000, endMs: 8000, sourceStartMs: 0, speed: 1 },
	];
	const projected = projectCaptionCues(
		[
			{ id: "source", startMs: 0, endMs: 500, text: "Real speech" },
			{ id: "one", clipId: "first", startMs: 1000, endMs: 2000, text: "First story" },
			{ id: "two", clipId: "second", startMs: 1000, endMs: 2000, text: "Second story" },
		],
		reused,
	);
	expect(projected.map((c) => [c.sourceCueId, c.clip.id, c.startMs, c.endMs])).toEqual([
		["source", "first", 0, 500],
		["one", "first", 1000, 2000],
		["source", "second", 4000, 4500],
		["two", "second", 5000, 6000],
	]);
});

it("follows explicit nested split ancestry without prefix matching unrelated clips", async () => {
	const { planClipSplit } = await import("./clipSplit");
	let id = 0;
	const first = planClipSplit({
		clipRegions: [{ id: "original", startMs: 0, endMs: 8000, speed: 1 }],
		splitMs: 4000,
		createId: () => `part-${++id}`,
	})!;
	const second = planClipSplit({
		clipRegions: [first.right],
		splitMs: 6000,
		createId: () => `part-${++id}`,
	})!;
	const clips = [
		first.left,
		second.left,
		second.right,
		{ id: "original-copy", startMs: 8000, endMs: 16000, sourceStartMs: 0, speed: 1 },
	];
	const projected = projectCaptionCues(
		[
			{ id: "whole", clipId: "original", startMs: 2000, endMs: 7000, text: "Original scene" },
			{
				id: "right",
				clipId: first.right.id,
				startMs: 4500,
				endMs: 6500,
				text: "Only the right scene",
			},
		],
		clips,
	);
	expect(
		projected.filter((c) => c.sourceCueId === "whole").map((c) => [c.startMs, c.endMs]),
	).toEqual([
		[2000, 4000],
		[4000, 6000],
		[6000, 7000],
	]);
	expect(
		projected.filter((c) => c.sourceCueId === "right").map((c) => [c.startMs, c.endMs]),
	).toEqual([
		[4500, 6000],
		[6000, 6500],
	]);
	expect(projected.every((c) => c.clip.id !== "original-copy")).toBe(true);
	const moved = projectCaptionCues(
		[{ id: "caption", clipId: first.right.id, startMs: 6500, endMs: 7000, text: "Moved" }],
		[{ ...second.right, startMs: 20000, endMs: 22000 }],
	);
	expect(moved.map((c) => [c.startMs, c.endMs])).toEqual([[20500, 21000]]);
});

it("preserves bound generated captions on fragments created by automatic trimming", async () => {
	const { applyEditPlan } = await import("./auto-edit/apply");
	const { baselineFor } = await import("./auto-edit/plan");
	const state = {
		clipRegions: [{ id: "original", startMs: 0, endMs: 10000, speed: 1 }],
		zoomRegions: [],
		annotationRegions: [],
		audioRegions: [],
		autoCaptions: [
			{
				id: "narration-1",
				clipId: "original",
				startMs: 6000,
				endMs: 7000,
				text: "After the cut",
			},
		],
		speedRegions: [],
	};
	const plan = {
		version: 1 as const,
		id: "trim",
		coordinateSpace: "timeline-ms" as const,
		baseline: baselineFor(state, "recording.mp4"),
		suggestions: [
			{
				id: "pause",
				kind: "trim" as const,
				reason: "silent-static" as const,
				startMs: 3000,
				endMs: 5000,
			},
		],
		warnings: [],
		reviewer: "rules" as const,
	};
	const after = applyEditPlan(state, "recording.mp4", plan, { pause: "accept" });
	const projected = projectCaptionCues(after.autoCaptions, after.clipRegions);
	expect(projected.map((c) => [c.startMs, c.endMs])).toEqual([[4000, 5000]]);
	expect(after.clipRegions[1].parentClipIds).toContain("original");
});
