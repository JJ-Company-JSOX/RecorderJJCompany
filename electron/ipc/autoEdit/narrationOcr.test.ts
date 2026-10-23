import { expect, it } from "vitest";
import { comparable, ocrCandidates } from "./narrationOcr";
import type { OcrLine } from "./ocrTypes";

const line = (text: string, box: OcrLine["box"], score = 0.95): OcrLine => ({ text, score, box });

it("names the line under the click first, then the nearest ones, skipping noise", () => {
	const before = [
		line("Help", [400, 10, 440, 30]),
		line("Settings", [300, 10, 380, 30]),
		line("File", [10, 10, 40, 30]),
		line("Settings  ", [300, 200, 380, 220]), // the same text again further away
		line("Sett1ngs", [300, 40, 380, 60], 0.3), // low confidence
		line("x", [330, 32, 336, 36]), // too small to be a label
		line("None", [200, 10, 240, 30]), // would clash with the "none" choice
	];
	const result = ocrCandidates(before, [], before, { x: 340, y: 20 });
	expect(result.clicked).toEqual(["Settings", "Help", "File"]);
	expect(result.underClick).toEqual({ text: "Settings", contains: true, score: 0.95 });
	// Nothing near the click: candidates are still offered, but none counts as "under" it.
	const far = ocrCandidates(before, [], before, { x: 900, y: 500 });
	expect(far.clicked[0]).toBe("Settings");
	expect(far.underClick).toBeUndefined();
});

it("offers only text that is new after the click, biggest first", () => {
	const before = [line("Document 1", [10, 100, 200, 116]), line("Ready", [10, 300, 80, 316])];
	const after = [
		line("Ready", [10, 300, 80, 316]),
		line("READY.", [10, 340, 80, 356]), // same text, other case and punctuation
		line("Apply", [300, 400, 360, 416]),
		line("General settings", [200, 120, 420, 150]),
		line("OK", [300, 440, 330, 456], 0.55), // read with too little confidence
		line("A", [500, 440, 510, 456]), // single characters are noise as a result
	];
	expect(ocrCandidates(before, after, before, { x: 0, y: 0 }).result).toEqual([
		"General settings",
		"Apply",
	]);
	expect(comparable("  Ｓｅｔｔｉｎｇｓ…  ")).toBe("settings");
	expect(comparable("设置 (Settings)")).toBe("设置 settings");
});
