import { expect, it } from "vitest";
import { assertSpeechTranscript, type SpeechTranscript, speechTokens } from "./speechTypes";

const transcript = (): SpeechTranscript => ({
	version: 1,
	durationMs: 2000,
	audioVerified: true,
	alignmentVerified: true,
	cues: [
		{
			id: "cue0",
			startMs: 100,
			endMs: 1800,
			text: "Please open",
			confidence: 0.98,
			words: [
				{ text: "Please", startMs: 100, endMs: 600 },
				{ text: "open", startMs: 650, endMs: 1800 },
			],
		},
	],
});

it("normalizes sentence punctuation while preserving numerical meaning and mixed languages", () => {
	expect(speechTokens("Please SAVE！")).toEqual(speechTokens("please save"));
	expect(speechTokens("请保存 file，tekan Save。")).toEqual([
		"请",
		"保",
		"存",
		"file",
		"tekan",
		"save",
	]);
	for (const [left, right] of [
		["-5", "5"],
		["1.5", "15"],
		["5%", "5"],
		["$5", "5"],
		["a/b", "a b"],
	])
		expect(speechTokens(left)).not.toEqual(speechTokens(right));
});

it("rejects source/word bounds and nonfinite confidence before model dispatch or projection", () => {
	expect(() => assertSpeechTranscript(transcript())).not.toThrow();
	for (const mutate of [
		(t: SpeechTranscript) => {
			t.cues[0].startMs = -1;
		},
		(t: SpeechTranscript) => {
			t.cues[0].endMs = 3000;
		},
		(t: SpeechTranscript) => {
			t.cues[0].confidence = Number.NaN;
		},
		(t: SpeechTranscript) => {
			t.cues[0].words![0].startMs = 0;
		},
		(t: SpeechTranscript) => {
			t.cues[0].words![0].endMs = 1900;
		},
	]) {
		const t = transcript();
		mutate(t);
		expect(() => assertSpeechTranscript(t)).toThrow();
	}
});
