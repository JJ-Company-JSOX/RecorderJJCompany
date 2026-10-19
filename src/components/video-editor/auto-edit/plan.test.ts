import { describe, expect, it } from "vitest";
import { buildClipDecodeRuns } from "@/lib/exporter/videoTimelineSegments";
import {
	createEditorHistoryStack,
	recordEditorHistorySnapshot,
	undoEditorHistoryStack,
} from "../editorHistory";
import { normalizeProjectEditor } from "../projectPersistence";
import { applyEditPlan } from "./apply";
import {
	baselineFor,
	buildEditPlan,
	type Decision,
	type EditState,
	type MediaEvidence,
	mergeLocalReview,
} from "./plan";

const source = "local-recording.mp4";
const state = (): EditState => ({
	clipRegions: [{ id: "clip-1", startMs: 0, endMs: 10000, speed: 1 }],
	zoomRegions: [],
	annotationRegions: [],
	audioRegions: [],
	autoCaptions: [],
	speedRegions: [],
});
const evidence = (): MediaEvidence => ({
	durationMs: 10000,
	staticRanges: [{ startMs: 2000, endMs: 7000 }],
	silentRanges: [{ startMs: 3000, endMs: 8000 }],
	audioVerified: true,
	warnings: [],
});
const build = (s = state(), e = evidence()) =>
	buildEditPlan({ state: s, source, evidence: e, cursor: [], id: "test" });
const acceptAll = (p: ReturnType<typeof build>): Record<string, Decision> =>
	Object.fromEntries(p.suggestions.filter((s) => !s.blocked).map((s) => [s.id, "accept"]));

describe("local edit planning", () => {
	it("keeps generated text boxes inside the recording instead of clipping their right edge", () => {
		const s = state();
		s.autoCaptions = [{ id: "c", startMs: 1000, endMs: 2000, text: "Offline video editor" }];
		const plan = build(s);
		const next = applyEditPlan(s, source, plan, acceptAll(plan));
		for (const annotation of next.annotationRegions) {
			expect(annotation.position.x).toBeGreaterThanOrEqual(0);
			expect(annotation.position.x + annotation.size.width).toBeLessThanOrEqual(100);
			expect(annotation.position.y + annotation.size.height).toBeLessThanOrEqual(100);
		}
		expect(next.annotationRegions).toHaveLength(1);
	});
	it("does not cut an independent webcam track whose frames were not analyzed", () => {
		const s = { ...state(), additionalVisualSource: "webcam.mp4|0" };
		const p = build(s);
		expect(p.suggestions).toEqual([]);
		expect(p.warnings).toContain("webcam-alignment-unverified");
	});
	it("survives project serialization and uses the existing export source ranges", () => {
		const s = state(),
			p = build(s),
			next = applyEditPlan(s, source, p, acceptAll(p));
		const reloaded = normalizeProjectEditor(JSON.parse(JSON.stringify(next)));
		expect(reloaded.clipRegions).toMatchObject(next.clipRegions);
		expect(buildClipDecodeRuns(reloaded.clipRegions)).toEqual([
			[
				{ startSec: 0, endSec: 3.4, speed: 1, outputStartSec: 0, outputEndSec: 3.4 },
				{ startSec: 6.6, endSec: 10, speed: 1, outputStartSec: 3.4, outputEndSec: 6.8 },
			],
		]);
	});
	it("requires BOTH silence and static frames, retaining edge padding", () => {
		expect(build().suggestions).toMatchObject([{ kind: "trim", startMs: 3400, endMs: 6600 }]);
		expect(build(state(), { ...evidence(), staticRanges: [] }).suggestions).toEqual([]);
		expect(build(state(), { ...evidence(), silentRanges: [] }).suggestions).toEqual([]);
		expect(build(state(), { ...evidence(), audioVerified: false }).suggestions).toEqual([]);
	});
	it("suggests a reversible speed edit for a short quiet/static pause", () => {
		const p = build(state(), { ...evidence(), silentRanges: [{ startMs: 3000, endMs: 5000 }] });
		expect(p.suggestions[0]).toMatchObject({ kind: "speed", speed: 1.5 });
		const next = applyEditPlan(state(), source, p, acceptAll(p));
		expect(next.clipRegions.map((c) => c.speed)).toEqual([1, 1.5, 1]);
		expect(next.clipRegions[2].sourceStartMs).toBe(4600);
		expect(next.clipRegions[2].endMs).toBe(9600);
	});
	it("retains footage even for an entirely silent/static recording", () => {
		const p = build(state(), {
			...evidence(),
			staticRanges: [{ startMs: 0, endMs: 10000 }],
			silentRanges: [{ startMs: 0, endMs: 10000 }],
		});
		const next = applyEditPlan(state(), source, p, acceptAll(p));
		expect(next.clipRegions.map((c) => [c.sourceStartMs, c.endMs - c.startMs])).toEqual([
			[0, 400],
			[9600, 400],
		]);
	});
	it.each([
		"这是办公室教程",
		"Please open the worksheet",
		"Sila buka lembaran kerja",
		"请 click sini，然后 tekan Save lah",
	])("protects supplied transcript without interpreting its language: %s", (text) => {
		const s = state();
		s.autoCaptions = [{ id: "cue", startMs: 4000, endMs: 5000, text }];
		const p = build(s);
		expect(p.suggestions.some((s) => s.kind === "trim" || s.kind === "speed")).toBe(false);
		expect(p.suggestions[0]).toMatchObject({ kind: "annotation", text });
		expect(applyEditPlan(s, source, p, acceptAll(p)).annotationRegions[0].content).toBe(text);
	});
	it("uses recorded click coordinates; click activity vetoes a cut", () => {
		const p = buildEditPlan({
			state: state(),
			source,
			evidence: evidence(),
			cursor: [{ timeMs: 4500, cx: 0.8, cy: 0.2, interactionType: "click" }],
			id: "click",
		});
		expect(p.suggestions).toMatchObject([{ kind: "zoom", focus: { cx: 0.8, cy: 0.2 } }]);
	});
	it("projects source clicks into reordered and sped-up clips", () => {
		const s = state();
		s.clipRegions = [
			{ id: "b", startMs: 0, endMs: 2000, sourceStartMs: 6000, speed: 2 },
			{ id: "a", startMs: 2000, endMs: 8000, sourceStartMs: 0, speed: 1 },
		];
		const p = buildEditPlan({
			state: s,
			source,
			evidence: { ...evidence(), audioVerified: false },
			cursor: [{ timeMs: 7000, cx: 0.2, cy: 0.3, interactionType: "click" }],
			id: "ordered",
		});
		expect(p.suggestions).toMatchObject([{ kind: "zoom", startMs: 325, endMs: 1250 }]);
	});
	it("protects existing audio, zooms, annotations and speed settings", () => {
		for (const key of ["audioRegions", "zoomRegions", "annotationRegions"] as const) {
			const s = state();
			Object.assign(s, { [key]: [{ id: "user", startMs: 4000, endMs: 5000 }] });
			const p = build(s);
			expect(p.suggestions[0].blocked).toBe("existing-edit");
			expect(() => applyEditPlan(s, source, p, { [p.suggestions[0].id]: "accept" })).toThrow(
				"conflicting-edit",
			);
		}
		const s = state();
		s.clipRegions[0].speed = 2;
		expect(build(s).suggestions[0].blocked).toBe("existing-speed");
	});
	it("splits only accepted ranges, preserves source in-points and moves later audio intact", () => {
		const s = state();
		s.audioRegions = [
			{ id: "music", startMs: 8000, endMs: 9500, audioPath: "music.wav", volume: 0.7 },
		];
		const original = structuredClone(s),
			p = build(s);
		const next = applyEditPlan(s, source, p, acceptAll(p));
		expect(s).toEqual(original);
		expect(next.clipRegions.map((c) => [c.startMs, c.endMs, c.sourceStartMs])).toEqual([
			[0, 3400, 0],
			[3400, 6800, 6600],
		]);
		expect(next.audioRegions[0]).toEqual({ ...s.audioRegions[0], startMs: 4800, endMs: 6300 });
	});
	it("leaves rejected/undecided items unchanged and refuses stale plans", () => {
		const s = state(),
			p = build(s);
		expect(applyEditPlan(s, source, p, {})).toEqual(s);
		expect(applyEditPlan(s, source, p, { [p.suggestions[0].id]: "reject" })).toEqual(s);
		const changed = {
			...s,
			zoomRegions: [
				{
					id: "new",
					startMs: 1,
					endMs: 100,
					depth: 1 as const,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
		};
		expect(() => applyEditPlan(changed, source, p, acceptAll(p))).toThrow("stale-plan");
		expect(() => applyEditPlan(s, "different.mp4", p, acceptAll(p))).toThrow("stale-plan");
		const next = applyEditPlan(s, source, p, acceptAll(p));
		expect(() => applyEditPlan(next, source, p, acceptAll(p))).toThrow("stale-plan");
	});
	it("restores the whole timeline in one existing history Undo", () => {
		const s = state(),
			p = build(s),
			next = applyEditPlan(s, source, p, acceptAll(p));
		const selections = {
			selectedZoomId: null,
			selectedClipId: null,
			selectedAnnotationId: null,
			selectedAudioId: null,
		};
		const stack = createEditorHistoryStack();
		recordEditorHistorySnapshot(stack, { ...s, ...selections });
		recordEditorHistorySnapshot(stack, { ...next, ...selections });
		expect(undoEditorHistoryStack(stack, { ...next, ...selections })).toEqual({
			...s,
			...selections,
		});
	});
});

describe("AI review boundaries", () => {
	it("allows omission or narrowing only and preserves rule explanations", () => {
		const p = build();
		const next = mergeLocalReview(p, [
			{ id: p.suggestions[0].id, startMs: 3500, endMs: 6500, kind: "zoom", text: "invented" },
		]);
		expect(next.suggestions[0]).toMatchObject({
			kind: "trim",
			reason: "silent-static",
			startMs: 3500,
			endMs: 6500,
		});
		expect(mergeLocalReview(p, []).suggestions).toEqual([]);
		expect(next.baseline).toBe(baselineFor(state(), source));
	});
	it.each([
		[{ id: "invented", startMs: 1, endMs: 2 }],
		[{ id: "suggestion-1", startMs: 0, endMs: 6600 }],
		[{ id: "suggestion-1", startMs: 3400, endMs: 7000 }],
		[{ id: "suggestion-1", startMs: "3400", endMs: 6600 }],
		[{ id: "suggestion-1", startMs: 4500, endMs: 4000 }],
		[
			{ id: "suggestion-1", startMs: 3400, endMs: 6600 },
			{ id: "suggestion-1", startMs: 3400, endMs: 6600 },
		],
	])("rejects ungrounded AI output %#", (value) =>
		expect(() => mergeLocalReview(build(), value)).toThrow());
});
