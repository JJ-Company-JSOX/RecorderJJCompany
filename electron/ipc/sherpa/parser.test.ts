import { describe, expect, it } from "vitest";
import { parseSherpaCaptionResult } from "./parser";
describe("Sherpa transcript coordinates", () => {
	it("offsets actual model segment timestamps and never invents confidence", () => {
		const cues = parseSherpaCaptionResult(
			JSON.stringify({
				text: "hello world",
				segment_timestamps: [0.2, 1],
				segment_durations: [0.4, 0.5],
				segment_texts: ["hello", "world"],
			}),
			30000,
			2000,
		);
		expect(cues.map((c) => [c.startMs, c.endMs])).toEqual([
			[30200, 30600],
			[31000, 31500],
		]);
		expect(
			cues.every((c) => c.confidence === undefined && c.alignment === "model-segment"),
		).toBe(true);
	});
	it("uses a labeled audio chunk when timestamps are missing or invalid", () => {
		for (const data of [
			{ text: "hello" },
			{
				text: "hello",
				segment_timestamps: [2.01],
				segment_durations: [0.01],
				segment_texts: ["hello"],
			},
			{
				text: "hello",
				segment_timestamps: [0, 0.2],
				segment_durations: [1, 1],
				segment_texts: ["a", "b"],
			},
		]) {
			expect(parseSherpaCaptionResult(JSON.stringify(data), 5000, 2000)).toEqual([
				{ startMs: 5000, endMs: 7000, text: "hello", alignment: "audio-chunk" },
			]);
		}
	});
	it("rejects malformed results and invalid source intervals", () => {
		expect(() => parseSherpaCaptionResult('{"text":3}', 0, 1000)).toThrow();
		expect(() => parseSherpaCaptionResult('{"text":"x"}', -1, 1000)).toThrow();
		expect(parseSherpaCaptionResult('{"text":"<|en|> "}', 0, 1000)).toEqual([]);
	});
});
