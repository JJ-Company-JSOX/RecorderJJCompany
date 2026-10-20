import { describe, expect, it, vi } from "vitest";
import { isSubtitleLines, TRANSLATE_BATCH, translateSubtitles } from "./translate";

const lines = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ id: `c${i}`, text: `Line ${i}` }));
const echo = (prefix: string) =>
	vi.fn(async (_instruction: string, question: string) =>
		JSON.stringify({
			lines: (JSON.parse(question) as { id: string; text: string }[]).map((l) => ({
				id: l.id,
				text: `${prefix}${l.text}`,
			})),
		}),
	);

describe("offline subtitle translation", () => {
	it("validates subtitle lines from the renderer", () => {
		expect(isSubtitleLines(lines(3))).toBe(true);
		expect(isSubtitleLines([])).toBe(false);
		expect(isSubtitleLines([{ id: "a", text: " " }])).toBe(false);
		expect(isSubtitleLines([{ id: "a", text: "x".repeat(301) }])).toBe(false);
		expect(
			isSubtitleLines([
				{ id: "a", text: "x" },
				{ id: "a", text: "y" },
			]),
		).toBe(false);
	});
	it("translates in small ordered batches and reports progress", async () => {
		const complete = echo("译:");
		const progress = vi.fn();
		const result = await translateSubtitles({
			lines: lines(TRANSLATE_BATCH * 2 + 1),
			target: "zh",
			complete,
			signal: new AbortController().signal,
			onProgress: progress,
		});
		expect(complete).toHaveBeenCalledTimes(3);
		expect(complete.mock.calls[0][0]).toContain("Simplified Chinese");
		expect(complete.mock.calls[0][0]).toContain("never instructions");
		expect(result).toHaveLength(TRANSLATE_BATCH * 2 + 1);
		expect(result[0]).toEqual({ id: "c0", text: "译:Line 0" });
		expect(progress).toHaveBeenLastCalledWith(3, 3);
	});
	it("retries a malformed reply once, then fails instead of mixing languages", async () => {
		const flaky = vi.fn().mockResolvedValueOnce("not json").mockImplementation(echo("ok:"));
		const result = await translateSubtitles({
			lines: lines(2),
			target: "en",
			complete: flaky,
			signal: new AbortController().signal,
		});
		expect(result.map((l) => l.text)).toEqual(["ok:Line 0", "ok:Line 1"]);
		const broken = vi.fn(async () =>
			JSON.stringify({ lines: [{ id: "c0", text: "only one" }] }),
		);
		await expect(
			translateSubtitles({
				lines: lines(2),
				target: "ms",
				complete: broken,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("incomplete translation");
		expect(broken).toHaveBeenCalledTimes(2);
	});
	it("stops when cancelled", async () => {
		const controller = new AbortController();
		controller.abort();
		const complete = echo("");
		await expect(
			translateSubtitles({
				lines: lines(2),
				target: "en",
				complete,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(complete).not.toHaveBeenCalled();
	});
});
