import { describe, expect, it } from "vitest";
import { narrationMoments, scheduleNarration } from "./narrationMoments";
import type { EditState } from "./plan";

const state = (overrides: Partial<EditState> = {}): EditState => ({
	clipRegions: [{ id: "clip", startMs: 0, endMs: 30000, speed: 1 }],
	zoomRegions: [],
	annotationRegions: [],
	audioRegions: [],
	autoCaptions: [],
	speedRegions: [],
	...overrides,
});
const click = (timeMs: number) => ({
	timeMs,
	cx: 0.25,
	cy: 0.75,
	interactionType: "click" as const,
});

describe("AI voice-over moments", () => {
	it("narrates a silent recording with no clicks every few seconds", () => {
		const moments = narrationMoments(state(), []);
		expect(moments.map((m) => m.id)).toEqual(["moment-1", "moment-2", "moment-3"]);
		expect(moments.every((m) => m.kind === "caption" && m.reason === "vision")).toBe(true);
		expect(moments[0].startMs).toBeGreaterThanOrEqual(0);
		expect(moments.at(-1)!.endMs).toBeLessThanOrEqual(30000);
	});
	it("uses existing zooms, including Recordly's own, and clicks without a zoom", () => {
		const moments = narrationMoments(
			state({
				zoomRegions: [
					{ id: "z", startMs: 1000, endMs: 3000, depth: 3, focus: { cx: 0.5, cy: 0.5 } },
				],
			}),
			[click(1500), click(10000), { ...click(20000), interactionType: "move" }],
		);
		expect(moments).toMatchObject([
			{ id: "zoom-1", kind: "zoom", focus: { cx: 0.5, cy: 0.5 } },
			{
				id: "click-1",
				kind: "caption",
				reason: "click",
				startMs: 10000,
				focus: { cx: 0.25 },
			},
		]);
	});
	it("maps clicks through cuts and speed-ups, skipping clicks in removed footage", () => {
		const moments = narrationMoments(
			state({
				clipRegions: [
					{ id: "a", startMs: 0, endMs: 5000, speed: 1 },
					{ id: "b", startMs: 5000, endMs: 10000, speed: 2, sourceStartMs: 20000 },
				],
			}),
			[click(2000), click(10000), click(24000)],
		);
		// 10 s was cut; 24 s plays at 2× from timeline 5 s → 7 s.
		expect(moments.map((m) => m.startMs)).toEqual([2000, 7000]);
	});
	it("keeps moments far enough apart that voices do not pile up", () => {
		const moments = narrationMoments(state(), [click(1000), click(2000), click(6000)]);
		expect(moments.map((m) => m.startMs)).toEqual([1000, 6000]);
	});
	it("starts each voice clip only after the previous one finishes", () => {
		expect(
			scheduleNarration([
				{ id: "b", startMs: 4000, durationMs: 1000 },
				{ id: "a", startMs: 1000, durationMs: 5000 },
			]),
		).toEqual([
			{ id: "a", startMs: 1000, durationMs: 5000, endMs: 6000 },
			{ id: "b", startMs: 6250, durationMs: 1000, endMs: 7250 },
		]);
	});
});
