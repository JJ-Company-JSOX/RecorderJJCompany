import { describe, expect, it } from "vitest";
import { estimateCharsPerSecond, speechRateSample, validSpeechRateSamples } from "./speechRate";
describe("local narration speech-rate learning", () => {
	it("falls back to the given default for a first run or a different language", () => {
		expect(estimateCharsPerSecond([], "zh", 3.5)).toBe(3.5);
		expect(estimateCharsPerSecond([{ key: "en", charsPerSecond: 20 }], "zh", 3.5)).toBe(3.5);
	});
	it("picks a slow-biased point among the last eight matching samples, ignoring a fast outlier", () => {
		const samples = [4, 4, 4, 4, 4, 4, 4, 100].map((charsPerSecond) => ({
			key: "zh",
			charsPerSecond,
		}));
		expect(estimateCharsPerSecond(samples, "zh", 3.5)).toBe(4);
	});
	it("uses the single sample when only one is on record", () => {
		expect(estimateCharsPerSecond([{ key: "en", charsPerSecond: 9 }], "en", 11)).toBe(9);
	});
	it("uses the slowest sample while few are on record, not a central pace", () => {
		const samples = [6, 9, 12, 15].map((charsPerSecond) => ({ key: "en", charsPerSecond }));
		expect(estimateCharsPerSecond(samples, "en", 11)).toBe(6);
	});
	it("ignores a too-short line or too-short clip, where lead-in silence would skew the rate", () => {
		expect(speechRateSample("en", 9, 5000)).toBeNull();
		expect(speechRateSample("en", 50, 499)).toBeNull();
	});
	it("computes a sane sample from enough text and audio", () => {
		expect(speechRateSample("en", 110, 10000)).toEqual({ key: "en", charsPerSecond: 11 });
	});
	it("rejects a measurement outside any plausible speaking pace", () => {
		expect(speechRateSample("en", 1000, 1000)).toBeNull();
		expect(speechRateSample("en", 10, 100000)).toBeNull();
	});
	it("bounds storage and ignores corrupt or implausible samples", () => {
		expect(validSpeechRateSamples(null)).toEqual([]);
		expect(
			validSpeechRateSamples([
				null,
				{},
				{ key: "zh", charsPerSecond: -1 },
				{ key: "zh", charsPerSecond: Infinity },
				{ key: "zh", charsPerSecond: 0.1 },
				{ key: "zh", charsPerSecond: 31 },
			]),
		).toEqual([]);
		expect(
			validSpeechRateSamples(
				Array.from({ length: 250 }, () => ({ key: "zh", charsPerSecond: 4 })),
			),
		).toHaveLength(200);
	});
});
