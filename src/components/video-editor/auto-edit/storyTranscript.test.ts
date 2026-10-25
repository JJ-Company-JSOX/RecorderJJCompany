import { describe, expect, it } from "vitest";
import {
	buildStoryTranscript,
	MAX_STORY_TRANSCRIPT_CHARACTERS,
	storyTextBudget,
} from "./storyTranscript";
import type { CaptionCue, ClipRegion } from "../types";
const clip = (patch: Partial<ClipRegion> = {}): ClipRegion => ({
	id: "c",
	startMs: 0,
	endMs: 10000,
	speed: 1,
	...patch,
});
const cue = (patch: Partial<CaptionCue> = {}): CaptionCue => ({
	id: "original",
	startMs: 1000,
	endMs: 2000,
	text: "Original spoken words",
	...patch,
});
describe("opt-in edited original subtitle evidence", () => {
	it("maps source subtitles through reordered, repeated and sped-up kept clips", () => {
		const result = buildStoryTranscript(
			[cue()],
			[
				clip({ id: "repeat", startMs: 20000, endMs: 25000, sourceStartMs: 0, speed: 2 }),
				clip(),
			],
		);
		expect(result.cues).toEqual([
			{ startMs: 1000, endMs: 2000, text: "Original spoken words" },
			{ startMs: 20500, endMs: 21000, text: "Original spoken words" },
		]);
		expect(result.truncated).toBe(false);
	});
	it("excludes generated narration, cut-out captions and unrelated footage sections", () => {
		const result = buildStoryTranscript(
			[
				cue(),
				cue({ id: "narration-story-1", text: "Do not repeat generated speech" }),
				cue({ id: "cut", startMs: 6000, endMs: 7000 }),
			],
			[clip({ sourceStartMs: 0, endMs: 5000 })],
			[{ id: "story-1", startMs: 0, endMs: 3000, sourceTimeMs: 1500 }],
		);
		expect(result.cues).toEqual([
			{ startMs: 1000, endMs: 2000, text: "Original spoken words" },
		]);
	});
	it("omits partial caption text without word timestamps rather than leaking removed speech", () => {
		const result = buildStoryTranscript(
			[cue({ startMs: 500, endMs: 2000, text: "Removed secret and retained speech" })],
			[clip({ sourceStartMs: 1000, endMs: 1000 })],
		);
		expect(result.cues).toEqual([]);
		expect(result.omittedPartialCues).toBe(1);
		expect(result.omittedCues).toBe(1);
		expect(result.truncated).toBe(true);
	});
	it("uses only fully kept timed words after a source trim and speed change", () => {
		const result = buildStoryTranscript(
			[
				cue({
					startMs: 500,
					endMs: 2000,
					text: "removed kept partial",
					words: [
						{ text: "removed", startMs: 500, endMs: 900 },
						{ text: "kept", startMs: 1100, endMs: 1400, leadingSpace: true },
						{ text: "partial", startMs: 1400, endMs: 2000, leadingSpace: true },
					],
				}),
			],
			[clip({ startMs: 5000, endMs: 5400, sourceStartMs: 1000, speed: 2 })],
		);
		expect(result.cues).toEqual([{ startMs: 5050, endMs: 5200, text: "kept" }]);
	});
	it("discloses bounded whole-cue sampling across the timeline without silently cutting text", () => {
		const captions = Array.from({ length: 200 }, (_, i) =>
			cue({
				id: `s${i}`,
				startMs: i * 1000,
				endMs: i * 1000 + 900,
				text: `Line ${i}: ${"x".repeat(90)}`,
			}),
		);
		const result = buildStoryTranscript(captions, [clip({ endMs: 200000 })]);
		expect(result.includedCues).toBeLessThanOrEqual(80);
		expect(result.includedCharacters).toBeLessThanOrEqual(MAX_STORY_TRANSCRIPT_CHARACTERS);
		expect(result.omittedCues).toBe(200 - result.includedCues);
		expect(result.truncated).toBe(true);
		expect(result.cues[0].text).toBe(captions[0].text);
		expect(result.cues.at(-1)!.text).toBe(captions.at(-1)!.text);
	});
	it("applies a smaller remaining aggregate budget without altering source captions", () => {
		const original = [cue({ text: "Long paragraph" })];
		const result = buildStoryTranscript(original, [clip()], undefined, 5);
		expect(result.cues).toEqual([]);
		expect(result.omittedCues).toBe(1);
		expect(original[0].text).toBe("Long paragraph");
	});
	it("respects clip-bound caption lineage while preserving ordinary source-caption repeats", () => {
		const bound = cue({ clipId: "original-clip" });
		const result = buildStoryTranscript(
			[bound],
			[
				clip({ id: "other-use" }),
				clip({
					id: "split-child",
					sourceStartMs: 0,
					startMs: 20000,
					endMs: 30000,
					parentClipIds: ["original-clip"],
				}),
			],
		);
		expect(result.cues).toEqual([
			{ startMs: 21000, endMs: 22000, text: "Original spoken words" },
		]);
	});
});

it("does not reintroduce speech from a gap between selected story sections", () => {
	const captions = [
		cue({
			startMs: 500,
			endMs: 2500,
			text: "Kept secret kept",
			words: [
				{ text: "Kept", startMs: 600, endMs: 900 },
				{ text: "secret", startMs: 1500, endMs: 1800, leadingSpace: true },
				{ text: "kept", startMs: 2100, endMs: 2400, leadingSpace: true },
			],
		}),
	];
	const scenes = [
		{ id: "story-1", startMs: 0, endMs: 1000, sourceTimeMs: 500 },
		{ id: "story-2", startMs: 2000, endMs: 3000, sourceTimeMs: 2500 },
	];
	expect(buildStoryTranscript(captions, [clip()], scenes).cues).toEqual([
		{ startMs: 600, endMs: 900, text: "Kept" },
		{ startMs: 2100, endMs: 2400, text: "kept" },
	]);
});

it("reports character guards separately from any model tokenizer estimate", () => {
	expect(storyTextBudget({ analyzeVideo: true })).toBe(2000);
	expect(storyTextBudget({ analyzeVideo: false })).toBe(4000);
});
