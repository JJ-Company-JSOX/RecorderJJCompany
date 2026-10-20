import { describe, expect, it } from "vitest";
import { applyEditPlan } from "./apply";
import type { Decision, EditPlan, EditState } from "./plan";
import { buildTextCutPlan, textLines } from "./textCuts";

const source = "talk.mp4";
const state = (overrides: Partial<EditState> = {}): EditState => ({
	clipRegions: [{ id: "clip", startMs: 0, endMs: 20000, speed: 1 }],
	zoomRegions: [],
	annotationRegions: [],
	audioRegions: [],
	autoCaptions: [
		{ id: "a", startMs: 1000, endMs: 3000, text: "Hello everyone." },
		{ id: "b", startMs: 3400, endMs: 6000, text: "Um, wait, let me restart." },
		{ id: "c", startMs: 6500, endMs: 9000, text: "Sorry about that." },
		{ id: "d", startMs: 12000, endMs: 15000, text: "Click Save to finish." },
	],
	speedRegions: [],
	...overrides,
});
const accept = (plan: EditPlan): Record<string, Decision> =>
	Object.fromEntries(plan.suggestions.map((s) => [s.id, "accept"]));

describe("editing by deleting subtitle lines", () => {
	it("lists subtitle lines in timeline order", () => {
		expect(textLines(state()).map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
	});
	it("cuts a deleted line without touching its neighbours", () => {
		const plan = buildTextCutPlan(state(), source, ["d"], "p");
		expect(plan.suggestions).toMatchObject([
			{ kind: "trim", reason: "transcript", startMs: 11850, endMs: 15150 },
		]);
		const middle = buildTextCutPlan(state(), source, ["b"], "p");
		// Padding stops at the end of "a" (3000) and the start of "c" (6500).
		expect(middle.suggestions).toMatchObject([{ startMs: 3250, endMs: 6150 }]);
	});
	it("joins neighbouring deleted lines into one cut", () => {
		const plan = buildTextCutPlan(state(), source, ["b", "c"], "p");
		expect(plan.suggestions).toHaveLength(1);
		expect(plan.suggestions[0]).toMatchObject({ startMs: 3250, endMs: 9150 });
		expect(plan.suggestions[0].text).toBe("Um, wait, let me restart. Sorry about that.");
	});
	it("applies as one undoable trim that removes the line and shrinks overlapping zooms", () => {
		const s = state({
			zoomRegions: [
				{ id: "z1", startMs: 4000, endMs: 5000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
				{ id: "z2", startMs: 12500, endMs: 17000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			],
		});
		const plan = buildTextCutPlan(s, source, ["b", "d"], "p");
		expect(plan.suggestions.every((x) => !x.blocked)).toBe(true);
		const next = applyEditPlan(s, source, plan, accept(plan));
		expect(textLines(next).map((l) => l.id)).toEqual(["a", "c"]);
		// z1 sat entirely inside the deleted line and disappears; z2 keeps its remaining part.
		expect(next.zoomRegions).toHaveLength(1);
		expect(next.zoomRegions[0].endMs - next.zoomRegions[0].startMs).toBe(17000 - 15150);
	});
	it("keeps added voice-over in sync by refusing to cut under it", () => {
		const s = state({
			audioRegions: [
				{ id: "n", startMs: 12000, endMs: 13000, audioPath: "/v.wav", volume: 1 },
			],
		});
		const plan = buildTextCutPlan(s, source, ["d"], "p");
		expect(plan.suggestions[0].blocked).toBe("existing-edit");
	});
	it("maps lines through cuts and speed changes already on the timeline", () => {
		const s = state({
			clipRegions: [
				{ id: "one", startMs: 0, endMs: 3000, speed: 1 },
				{ id: "two", startMs: 3000, endMs: 9000, speed: 2, sourceStartMs: 8000 },
			],
		});
		// "d" (source 12–15 s) plays at 2× from timeline 5 s.
		expect(textLines(s).find((l) => l.id === "d")).toMatchObject({
			startMs: 5000,
			endMs: 6500,
		});
		const next = applyEditPlan(s, source, buildTextCutPlan(s, source, ["d"], "p"), {
			"text-cut-1": "accept",
		});
		expect(textLines(next).map((l) => l.id)).toEqual(["a", "c"]);
	});
});
