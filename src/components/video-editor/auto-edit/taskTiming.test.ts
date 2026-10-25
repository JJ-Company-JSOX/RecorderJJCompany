import { describe, expect, it } from "vitest";
import { estimateRange, formatWait, validSamples, workloadBucket } from "./taskTiming";
describe("local task wait estimates", () => {
	it("does not invent an estimate for a first run or a different model", () => {
		expect(estimateRange([], "new-model")).toBeNull();
		expect(estimateRange([{ key: "other-model", durationMs: 10000 }], "new-model")).toBeNull();
	});
	it("uses only the last five successful comparable samples with a margin", () => {
		const samples = [100000, 10000, 20000, 10000, 10000, 10000].map((durationMs) => ({
			key: "draft",
			durationMs,
		}));
		expect(estimateRange(samples, "draft")).toEqual([7000, 30000]);
	});
	it("bounds storage and ignores corrupt and sub-second measurements", () => {
		expect(validSamples(null)).toEqual([]);
		expect(
			validSamples([
				null,
				{},
				{ key: "a", durationMs: -1 },
				{ key: "a", durationMs: Infinity },
				{ key: "a", durationMs: 999 },
			]),
		).toEqual([]);
		expect(
			validSamples(Array.from({ length: 150 }, () => ({ key: "a", durationMs: 5000 }))),
		).toHaveLength(100);
	});
	it("groups similar workloads without assuming inference scales linearly", () => {
		expect(workloadBucket(0)).toBe(1);
		expect(workloadBucket(5)).toBe(8);
		expect(workloadBucket(8)).toBe(8);
		expect(workloadBucket(9)).toBe(16);
		expect(formatWait(61500)).toBe("1:02");
	});
});
