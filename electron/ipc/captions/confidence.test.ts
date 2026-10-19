import { expect, it } from "vitest";
import { attachWhisperConfidence, parseWhisperTokenEvidence } from "./confidence";
import { mergeCaptionSources } from "./mergeSources";
import { segmentCuesIntoPhrases } from "./segment";
import { parseWhisperJsonCues } from "./parser";

const json = (tokens: unknown[]) => JSON.stringify({ transcription: [{ tokens }] });
const token = (text: string, from: number, to: number, p?: number) => ({
	text,
	offsets: { from, to },
	...(p === undefined ? {} : { p }),
});
const cue = {
	id: "caption-1",
	startMs: 0,
	endMs: 2000,
	text: "Hello world.",
	words: [
		{ text: "Hello", startMs: 0, endMs: 800 },
		{ text: "world.", startMs: 900, endMs: 1800 },
	],
};

it("reports the real arithmetic mean and ignores model control tokens", () => {
	const evidence = parseWhisperTokenEvidence(
		json([
			token("[_BEG_]", 0, 0, 0),
			token(" Hello", 0, 800, 0.8),
			token(" world.", 900, 1800, 0.6),
			token("<|endoftext|>", 1800, 1800, 0),
		]),
	);
	expect(attachWhisperConfidence([cue], evidence)[0].confidence).toBeCloseTo(0.7);
});

it("does not invent confidence for SRT, malformed JSON, or partial token probabilities", () => {
	for (const evidence of [
		[],
		parseWhisperTokenEvidence("bad json"),
		parseWhisperTokenEvidence(
			json([token(" Hello", 0, 800, 0.99), token(" world.", 900, 1800)]),
		),
		parseWhisperTokenEvidence(json([token(" Hello", 0, 800, 1.4)])),
	])
		expect(attachWhisperConfidence([cue], evidence)[0]).not.toHaveProperty("confidence");
});

it("scores each segmented phrase from its own speech spans rather than adjacent padding", () => {
	const cues = [
		{
			id: "first",
			startMs: 0,
			endMs: 1080,
			text: "First.",
			words: [{ text: "First.", startMs: 0, endMs: 1000 }],
		},
		{
			id: "second",
			startMs: 1000,
			endMs: 2080,
			text: "Second.",
			words: [{ text: "Second.", startMs: 1080, endMs: 2000 }],
		},
	];
	const evidence = parseWhisperTokenEvidence(
		json([token("First.", 0, 1000, 0.95), token("Second.", 1080, 2000, 0.35)]),
	);
	expect(attachWhisperConfidence(cues, evidence).map((c) => c.confidence)).toEqual([0.95, 0.35]);
});

it("keeps track confidence and unique IDs while marking partially masked system text uncertain", () => {
	const mic = [
		{ id: "caption-1", startMs: 900, endMs: 1800, text: "Microphone", confidence: 0.9 },
	];
	const system = [{ ...cue, confidence: 0.7 }];
	const merged = mergeCaptionSources(mic, system);
	expect(new Set(merged.map((c) => c.id)).size).toBe(merged.length);
	expect(merged.find((c) => c.text === "Microphone")?.confidence).toBe(0.9);
	expect(merged.find((c) => c.text === "Hello")).toMatchObject({
		confidence: 0.7,
		uncertain: true,
	});
});

it("recognizes that caption edge padding can exceed media duration", () => {
	const result = segmentCuesIntoPhrases(
		[
			{
				id: "caption-1",
				startMs: 0,
				endMs: 2000,
				text: "Hello.",
				words: [{ text: "Hello.", startMs: 0, endMs: 2000 }],
			},
		],
		[],
	);
	// Callers with the known video duration must clip this existing 80ms edge
	// padding before applying strict transcript or semantic-plan bounds.
	expect(result[0].endMs).toBeGreaterThan(2000);
	expect(result[0].words?.[0].endMs).toBeLessThanOrEqual(result[0].endMs);
});

it("retains intact CJK segment text when byte-fallback token fragments contain replacement characters", () => {
	const source = JSON.stringify({
		transcription: [
			{
				offsets: { from: 0, to: 1000 },
				text: "离线编辑器。",
				tokens: [token("\uFFFD", 0, 500, 0.9), token("\uFFFD编辑器。", 500, 1000, 0.8)],
			},
		],
	});
	const cues = parseWhisperJsonCues(source);
	expect(cues[0].text).toBe("离线编辑器。");
	expect(cues[0].words).toBeUndefined();
	expect(
		attachWhisperConfidence(cues, parseWhisperTokenEvidence(source))[0].confidence,
	).toBeCloseTo(0.85);
});
