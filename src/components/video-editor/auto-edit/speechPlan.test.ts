import { expect, it } from "vitest";
import { validateSpeechPlan } from "../../../../electron/ipc/autoEdit/speechPlan";
import { applyEditPlan } from "./apply";
import { baselineFor, type Decision, type EditPlan, type EditState } from "./plan";
import { addSpeechSuggestions } from "./speechPlan";
import type { SpeechAnalysis, SpeechTranscript } from "./speechTypes";

const source = "synthetic.mp4";
const state = (): EditState => ({
	clipRegions: [{ id: "main", startMs: 0, endMs: 10000, speed: 1 }],
	zoomRegions: [],
	annotationRegions: [],
	audioRegions: [],
	autoCaptions: [],
	speedRegions: [],
});
const transcript = (): SpeechTranscript => ({
	version: 1,
	durationMs: 10000,
	audioVerified: true,
	alignmentVerified: true,
	cues: [
		{
			id: "first",
			startMs: 1000,
			endMs: 2000,
			text: "Open file",
			confidence: 0.98,
			vadBoundaryVerified: true,
		},
		{
			id: "last",
			startMs: 4000,
			endMs: 5000,
			text: "Open file",
			confidence: 0.98,
			vadBoundaryVerified: true,
		},
	],
});
const analysis = (t = transcript()): SpeechAnalysis =>
	validateSpeechPlan(
		{
			edits: [
				{
					kind: "repeat",
					removeCueIds: ["first"],
					keepCueIds: ["last"],
					rationale: "Repeated take",
				},
			],
		},
		t,
	);
const base = (s: EditState): EditPlan => ({
	version: 1,
	id: "speech-test",
	coordinateSpace: "timeline-ms",
	baseline: baselineFor(s, source),
	suggestions: [],
	warnings: [],
	reviewer: "rules",
});
const trims = (plan: EditPlan) => plan.suggestions.filter((s) => s.kind === "trim");

it("generates a reversible draft, stores captions in source space, and applies one source-accurate cut", () => {
	const s = state(),
		before = JSON.stringify(s),
		a = analysis();
	const p = addSpeechSuggestions(base(s), s, source, a);
	expect(JSON.stringify(s)).toBe(before);
	expect(trims(p)).toMatchObject([{ startMs: 1000, endMs: 2000, blocked: undefined }]);
	expect(p.suggestions.filter((s) => s.kind === "caption").map((s) => s.cue)).toEqual(
		a.transcript.cues,
	);
	const decisions: Record<string, Decision> = Object.fromEntries(
		p.suggestions.filter((s) => !s.blocked).map((s) => [s.id, "accept"]),
	);
	const next = applyEditPlan(s, source, p, decisions);
	expect(next.clipRegions.map((c) => [c.sourceStartMs, c.endMs - c.startMs])).toEqual([
		[0, 1000],
		[2000, 8000],
	]);
	expect(next.autoCaptions.find((c) => c.id === "last")).toMatchObject({
		startMs: 4000,
		endMs: 5000,
	});
	expect(JSON.stringify(s)).toBe(before);
});

it("projects repeat removals per retained source clip and refuses a missing or partial kept take", () => {
	const s = state();
	s.clipRegions = [{ id: "offset", startMs: 0, endMs: 6000, sourceStartMs: 500, speed: 1 }];
	expect(trims(addSpeechSuggestions(base(s), s, source, analysis()))).toMatchObject([
		{ startMs: 500, endMs: 1500 },
	]);
	s.clipRegions[0].endMs = 4000; // Original kept cue ends at 5000, outside this clip.
	expect(trims(addSpeechSuggestions(base(s), s, source, analysis()))).toHaveLength(0);
	s.clipRegions = [
		{ id: "partial-remove", startMs: 0, endMs: 8000, sourceStartMs: 1500, speed: 1 },
	];
	expect(trims(addSpeechSuggestions(base(s), s, source, analysis()))).toHaveLength(0);
});

it("retains the final timeline take after clip reorder instead of trusting source chronology", () => {
	const s = state();
	s.clipRegions = [
		{ id: "kept-first", startMs: 0, endMs: 2000, sourceStartMs: 3500, speed: 1 },
		{ id: "first-last", startMs: 2000, endMs: 4000, sourceStartMs: 500, speed: 1 },
	];
	expect(trims(addSpeechSuggestions(base(s), s, source, analysis()))).toHaveLength(0);
});

it("does not treat independently reordered keeper fragments as a complete later take", () => {
	const t = transcript();
	t.cues[1] = {
		id: "keep1",
		startMs: 4000,
		endMs: 4500,
		text: "Open",
		confidence: 0.98,
		vadBoundaryVerified: true,
	};
	t.cues.push({
		id: "keep2",
		startMs: 4500,
		endMs: 5000,
		text: "file",
		confidence: 0.98,
		vadBoundaryVerified: true,
	});
	const a = validateSpeechPlan(
		{
			edits: [
				{
					kind: "repeat",
					removeCueIds: ["first"],
					keepCueIds: ["keep1", "keep2"],
					rationale: "repeat",
				},
			],
		},
		t,
	);
	const s = state();
	s.clipRegions = [
		{ id: "remove", startMs: 0, endMs: 2500, sourceStartMs: 0, speed: 1 },
		{ id: "fragment2", startMs: 2500, endMs: 3000, sourceStartMs: 4500, speed: 1 },
		{ id: "fragment1", startMs: 3000, endMs: 3500, sourceStartMs: 4000, speed: 1 },
	];
	expect(trims(addSpeechSuggestions(base(s), s, source, a))).toHaveLength(0);
});

it("blocks uncertain confidence, existing authored effects and speed changes", () => {
	const s = state(),
		t = transcript();
	delete t.cues[0].confidence;
	expect(trims(addSpeechSuggestions(base(s), s, source, analysis(t)))[0].blocked).toBe(
		"speech-confidence-unverified",
	);
	s.zoomRegions = [
		{ id: "manual", startMs: 1200, endMs: 1800, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
	];
	expect(trims(addSpeechSuggestions(base(s), s, source, analysis()))[0].blocked).toBe(
		"existing-edit",
	);
	s.zoomRegions = [];
	s.clipRegions[0].speed = 2;
	expect(trims(addSpeechSuggestions(base(s), s, source, analysis()))[0].blocked).toBe(
		"existing-speed",
	);
});

it("vetoes silence cuts across recognized speech and leaves other timing edits nonoverlapping", () => {
	const s = state(),
		p = base(s);
	p.suggestions = [
		{ id: "false-silence", kind: "trim", reason: "silent-static", startMs: 900, endMs: 2100 },
		{ id: "real-pause", kind: "trim", reason: "silent-static", startMs: 6000, endMs: 7000 },
	];
	const next = addSpeechSuggestions(p, s, source, analysis());
	expect(trims(next).map((cut) => [cut.startMs, cut.endMs])).toEqual([
		[6000, 7000],
		[1000, 2000],
	]);
	expect(next.warnings).toContain("speech-protects-audio");
});

it("globally rejects cross-window keeper chains, preserves prior captions and rejects stale plans", () => {
	const s = state(),
		t = transcript();
	t.cues.push({
		id: "final",
		startMs: 7000,
		endMs: 8000,
		text: "Open file",
		confidence: 0.98,
		vadBoundaryVerified: true,
	});
	const a = analysis(t);
	a.cuts.push({
		kind: "repeat",
		removeCueIds: ["last"],
		keepCueIds: ["final"],
		rationale: "other window",
	});
	s.autoCaptions = [{ ...t.cues[0], text: "Authored caption" }];
	const p = addSpeechSuggestions(base(s), s, source, a);
	expect(trims(p).some((cut) => cut.startMs === 1000)).toBe(false);
	expect(p.suggestions.some((cut) => cut.kind === "caption" && cut.cue?.id === "first")).toBe(
		false,
	);
	const stale = base(s);
	s.clipRegions[0].endMs--;
	expect(() => addSpeechSuggestions(stale, s, source, a)).toThrow("stale-plan");
});
