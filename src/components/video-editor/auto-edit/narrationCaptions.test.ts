import { describe, expect, it } from "vitest";
import { narrationCaptions, splitNarrationLine } from "./narrationCaptions";
import type { EditState } from "./plan";

const state = (overrides: Partial<EditState> = {}): EditState => ({
	clipRegions: [
		{ id: "a", startMs: 0, endMs: 4000, speed: 1 },
		// Second clip starts at source 10 s and plays at 2×.
		{ id: "b", startMs: 4000, endMs: 8000, speed: 2, sourceStartMs: 10000 },
	],
	zoomRegions: [],
	annotationRegions: [],
	audioRegions: [],
	autoCaptions: [],
	speedRegions: [],
	...overrides,
});
const region = (id: string, startMs: number, endMs: number) => ({
	id: `narration-${id}`,
	startMs,
	endMs,
	audioPath: `/tmp/${id}.wav`,
	volume: 1,
});

describe("narration subtitles", () => {
	it("splits lines at punctuation and keeps long pieces short", () => {
		expect(splitNarrationLine("先点击设置，然后打开菜单。")).toEqual([
			"先点击设置，",
			"然后打开菜单。",
		]);
		expect(splitNarrationLine("Click save. Then wait.")).toEqual(["Click save.", "Then wait."]);
		const long = splitNarrationLine(
			"This sentence has many words and should be broken into shorter readable chunks",
		);
		expect(long.length).toBeGreaterThan(1);
		expect(long.every((c) => c.length <= 28)).toBe(true);
		expect(long.join(" ")).toBe(
			"This sentence has many words and should be broken into shorter readable chunks",
		);
	});
	it("maps narration clips from timeline time to source time, chunk by chunk", () => {
		const cues = narrationCaptions(
			state(),
			[region("s1", 1000, 3000), region("s2", 5000, 6000)],
			[
				{ id: "s1", text: "先点击，再保存。" },
				{ id: "s2", text: "Zoom in." },
			],
		);
		expect(cues.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))).toEqual([
			{ startMs: 1000, endMs: 2000, text: "先点击，" },
			{ startMs: 2000, endMs: 3000, text: "再保存。" },
			// Timeline 5–6 s inside clip b = source 12–14 s.
			{ startMs: 12000, endMs: 14000, text: "Zoom in." },
		]);
		expect(new Set(cues.map((c) => c.id)).size).toBe(cues.length);
	});
	it("keeps a line inside the clip where its voice starts and skips existing subtitles", () => {
		const cues = narrationCaptions(
			state({ autoCaptions: [{ id: "x", startMs: 12500, endMs: 13000, text: "Hi" }] }),
			[region("s1", 3000, 5000), region("s2", 5000, 6000)],
			[
				{ id: "s1", text: "Across the cut" },
				{ id: "s2", text: "Overlaps" },
			],
		);
		expect(cues).toHaveLength(1);
		expect(cues[0]).toMatchObject({ startMs: 3000, endMs: 4000, text: "Across the cut" });
	});
});
