import { describe, expect, it } from "vitest";
import { parseSceneAnalysis } from "./detect";
const result = (scenes: unknown, durationMs = 4000) =>
	JSON.stringify({
		version: 1,
		engine: "PySceneDetect",
		engineVersion: "0.7.2",
		durationMs,
		timing: "sampled-frame-boundary",
		frameSkip: 2,
		scenes,
	});
describe("scene boundaries from the native worker", () => {
	it("keeps sampled source timestamps instead of making highlight or deletion claims", () => {
		expect(
			parseSceneAnalysis(
				result([
					{ startMs: 0, endMs: 1500 },
					{ startMs: 1500, endMs: 4000 },
				]),
			),
		).toMatchObject({
			timing: "sampled-frame-boundary",
			scenes: [
				{ startMs: 0, endMs: 1500 },
				{ startMs: 1500, endMs: 4000 },
			],
		});
	});
	it.each([
		[
			{ startMs: 0, endMs: 2000 },
			{ startMs: 1800, endMs: 4000 },
		],
		[{ startMs: -1, endMs: 4000 }],
		[{ startMs: 0, endMs: 5000 }],
		[{ startMs: 0, endMs: 0 }],
		[],
	])("rejects unsafe worker ranges %#", (scenes) =>
		expect(() => parseSceneAnalysis(result(scenes))).toThrow());
	it("rejects output from an unexpected executable/schema", () =>
		expect(() =>
			parseSceneAnalysis(
				result([{ startMs: 0, endMs: 4000 }]).replace("PySceneDetect", "unknown"),
			),
		).toThrow());
});
