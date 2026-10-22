import { expect, it } from "vitest";
import {
	addVisualSuggestions,
	parseVisualReply,
	parseVisualResponse,
	type VisualAnalysis,
} from "./vision";
import { baselineFor, type EditPlan, type EditState } from "./plan";
import { applyEditPlan } from "./apply";
const source = "fixture.mp4";
const state = (): EditState => ({
	clipRegions: [
		{ id: "a", startMs: 0, endMs: 4000, sourceStartMs: 2000, speed: 2 },
		{ id: "b", startMs: 4000, endMs: 8000, sourceStartMs: 2000, speed: 2 },
	],
	zoomRegions: [],
	annotationRegions: [],
	audioRegions: [],
	speedRegions: [],
	autoCaptions: [],
});
const plan = (s: EditState): EditPlan => ({
	version: 1,
	id: "test",
	coordinateSpace: "timeline-ms",
	baseline: baselineFor(s, source),
	suggestions: [],
	warnings: [],
	reviewer: "rules",
});
const analysis: VisualAnalysis = {
	durationMs: 10000,
	sampledTimesMs: [4000],
	observations: [
		{
			timeMs: 4000,
			focus: { cx: 0.7, cy: 0.3 },
			caption: "Save 保存 Simpan",
		},
	],
	elapsedMs: 10,
	model: "fixture",
};
it("projects source observations into sped-up and repeated clips, requires explicit decisions and applies to real tracks", () => {
	const s = state(),
		p = addVisualSuggestions(plan(s), s, source, analysis);
	expect(p.suggestions.map((x) => [x.kind, x.startMs, x.endMs])).toEqual([
		["zoom", 750, 1900],
		["zoom", 4750, 5900],
	]);
	expect(applyEditPlan(s, source, p, {})).toEqual(s);
	const result = applyEditPlan(
		s,
		source,
		p,
		Object.fromEntries(p.suggestions.map((x) => [x.id, "accept"])),
	);
	expect(result.zoomRegions).toHaveLength(2);
	expect(result.annotationRegions).toHaveLength(0);
	expect(result.clipRegions).toEqual(s.clipRegions);
});
it("does not change rule cuts, invent speed edits or accept model instructions", () => {
	const s = state(),
		base = plan(s);
	base.suggestions = [
		{ id: "cut", kind: "trim", reason: "silent-static", startMs: 2500, endMs: 3500 },
	];
	const p = addVisualSuggestions(base, s, source, analysis);
	expect(p.suggestions[0]).toEqual(base.suggestions[0]);
	expect(p.suggestions.filter((x) => x.reason === "vision").every((x) => x.kind === "zoom")).toBe(
		true,
	);
	expect(() =>
		parseVisualResponse({ focus: { cx: 700, cy: 300 }, caption: "x" }, 4000),
	).toThrow();
	expect(() => parseVisualResponse({ focus: null, caption: "x".repeat(241) }, 4000)).toThrow();
});
it("reads the model's integer 0-1000 coordinates and converts them to frame fractions", () => {
	expect(parseVisualReply({ focus: { x: 700, y: 300 }, caption: " Save " }, 4000)).toEqual({
		timeMs: 4000,
		focus: { cx: 0.7, cy: 0.3 },
		caption: "Save",
	});
	expect(parseVisualReply({ focus: { x: 0, y: 1000 }, caption: "" }, 0).focus).toEqual({
		cx: 0,
		cy: 1,
	});
	expect(parseVisualReply({ focus: null, caption: "" }, 0).focus).toBeNull();
	// Fractions, out-of-range or missing values are not silently rescaled.
	for (const focus of [
		{ x: 0.7, y: 0.3 },
		{ x: 1001, y: 5 },
		{ x: -1, y: 5 },
		{ cx: 0.5, cy: 0.5 },
	])
		expect(() => parseVisualReply({ focus, caption: "" }, 0)).toThrow();
	// An older reply with a rationale field still parses; the field is ignored.
	expect(parseVisualReply({ focus: null, caption: "x", rationale: "old" }, 0)).toEqual({
		timeMs: 0,
		focus: null,
		caption: "x",
	});
});
it("protects pre-existing edits, rejects changed baselines, and replacing a visual run does not duplicate suggestions", () => {
	const s = state();
	s.zoomRegions = [
		{ id: "existing", startMs: 0, endMs: 3000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
	];
	const p = addVisualSuggestions(plan(s), s, source, analysis);
	expect(p.suggestions.find((x) => x.kind === "zoom")?.blocked).toBe("existing-zoom");
	expect(addVisualSuggestions(p, s, source, analysis).suggestions).toEqual(p.suggestions);
	expect(() =>
		addVisualSuggestions(p, { ...s, additionalVisualSource: "other" }, source, analysis),
	).toThrow();
});
it("rejects observations outside the analyzed video", () => {
	const s = state();
	expect(() =>
		addVisualSuggestions(plan(s), s, source, {
			...analysis,
			observations: [{ ...analysis.observations[0], timeMs: 10001 }],
		}),
	).toThrow();
});
