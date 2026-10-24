import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "../projectPersistence";
import type { AudioRegion } from "../types";
import { buildResolvedAudioPlan } from "@/lib/exporter/audioRoutingEngine";
import { changeAudioRegionSpan, splitAudioRegion } from "./audioRegionTiming";

const region: AudioRegion = {
	id: "voice",
	startMs: 1000,
	endMs: 4000,
	audioPath: "/voice.wav",
	volume: 1,
};
describe("non-destructive user audio timing", () => {
	it("splits into adjacent clips referencing consecutive parts of the same original audio", () => {
		const split = splitAudioRegion({ ...region, sourceOffsetMs: 300 }, 2500, "right");
		expect(split).toMatchObject([
			{ id: "voice", startMs: 1000, endMs: 2500, sourceOffsetMs: 300 },
			{ id: "right", startMs: 2500, endMs: 4000, sourceOffsetMs: 1800 },
		]);
		expect(splitAudioRegion(region, 1000, "unused")).toEqual([region]);
	});
	it("trims the original audio from the left and preserves that trim when moving", () => {
		const trimmed = changeAudioRegionSpan(region, { start: 1500, end: 4000 });
		expect(trimmed.sourceOffsetMs).toBe(500);
		const moved = changeAudioRegionSpan(trimmed, { start: 2500, end: 5000 }, 2);
		expect(moved).toMatchObject({
			startMs: 2500,
			endMs: 5000,
			sourceOffsetMs: 500,
			trackIndex: 2,
		});
	});
	it("resizing the right edge does not change the left trim", () => {
		expect(
			changeAudioRegionSpan({ ...region, sourceOffsetMs: 500 }, { start: 1000, end: 2500 })
				.sourceOffsetMs,
		).toBe(500);
	});
	it("allows restoring trimmed audio without extending before the source begins", () => {
		const trimmed = { ...region, startMs: 1500, sourceOffsetMs: 500 };
		expect(changeAudioRegionSpan(trimmed, { start: 500, end: 4000 })).toMatchObject({
			startMs: 1000,
			sourceOffsetMs: 0,
		});
	});
	it("retains offsets through JSON save/reopen and shares them with the preview routing plan", () => {
		const trimmed = changeAudioRegionSpan(region, { start: 1750, end: 4000 });
		const reopened = normalizeProjectEditor(
			JSON.parse(JSON.stringify({ audioRegions: [trimmed] })),
		);
		expect(reopened.audioRegions[0].sourceOffsetMs).toBe(750);
		const plan = buildResolvedAudioPlan({
			videoResource: null,
			sourceAudioFallbackPaths: [],
			audioRegions: reopened.audioRegions,
		});
		expect(plan.tracks[0].sourceRef.offsetMs).toBe(750);
		expect(plan.tracks[0].timelineBinding).toEqual({ startMs: 1750, endMs: 4000 });
	});
	it("keeps old projects at offset zero and rejects invalid offsets/spans", () => {
		for (const sourceOffsetMs of [undefined, -100, NaN, Infinity]) {
			expect(
				normalizeProjectEditor({ audioRegions: [{ ...region, sourceOffsetMs }] })
					.audioRegions[0].sourceOffsetMs,
			).toBe(0);
		}
		expect(changeAudioRegionSpan(region, { start: NaN, end: 4000 })).toBe(region);
	});
});
