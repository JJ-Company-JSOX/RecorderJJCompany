import { expect, it } from "vitest";
import { boundSpeechCues, speechWindows } from "./transcript";

it("allows genuine DTW plus acoustic phrase bounds without fabricating word timings", () => {
	const cue = {
		id: "a",
		text: "保存",
		startMs: 100,
		endMs: 900,
		confidence: 0.94,
		alignment: "dtw-speech" as const,
	};
	expect(boundSpeechCues([cue], 1000)).toEqual([{ ...cue, words: undefined, uncertain: false }]);
});

it("bounds multilingual context with overlap and guarantees progress through all cues", () => {
	const cues = Array.from({ length: 40 }, (_, i) => ({
		id: `cue-${i}`,
		text: "中".repeat(900),
		startMs: i * 1000,
		endMs: i * 1000 + 900,
	}));
	const windows = speechWindows({
		version: 1,
		durationMs: 40000,
		audioVerified: true,
		alignmentVerified: true,
		cues,
	});
	expect(windows.length).toBe(39);
	expect(windows.every((w) => w.cues.reduce((sum, c) => sum + c.text.length, 0) <= 2000)).toBe(
		true,
	);
	expect(new Set(windows.flatMap((w) => w.cues.map((c) => c.id))).size).toBe(40);
});

it("clips real phrase padding and word spans to source bounds and protects clipped speech", () => {
	const input = [
		{
			id: "a",
			text: "Save",
			startMs: -20,
			endMs: 1080,
			confidence: 0.99,
			words: [{ text: "Save", startMs: -10, endMs: 1050 }],
		},
	];
	expect(boundSpeechCues(input, 1000)).toEqual([
		{
			...input[0],
			startMs: 0,
			endMs: 1000,
			uncertain: true,
			words: [{ text: "Save", startMs: 0, endMs: 1000 }],
		},
	]);
	expect(input[0].endMs).toBe(1080);
});
it("preserves measured confidence, flags phrase-only timing, and discards out-of-source cues", () => {
	expect(
		boundSpeechCues(
			[
				{ id: "a", text: "保存", startMs: 10, endMs: 900, confidence: 0.93 },
				{ id: "b", text: "outside", startMs: 2000, endMs: 3000 },
			],
			1000,
		),
	).toEqual([
		{
			id: "a",
			text: "保存",
			startMs: 10,
			endMs: 900,
			confidence: 0.93,
			words: undefined,
			uncertain: true,
		},
	]);
});
