import { describe, expect, it } from "vitest";
import { narrationCaptions, splitNarrationLine } from "./narrationCaptions";
import { splitNarrationSentences } from "./narrationText";
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
		// A dot inside a number or a word is not the end of a piece.
		expect(splitNarrationLine("Install 2.0, open github.com")).toEqual([
			"Install 2.0,",
			"open github.com",
		]);
		// A quoted on-screen label is one piece, in Chinese and English lines.
		expect(splitNarrationLine("接着点击“Dark mode”，出现“Theme: Dark”。好。")).toEqual([
			"接着点击“Dark mode”，",
			"出现“Theme: Dark”。",
			"好。",
		]);
		expect(splitNarrationLine('Choose "Theme: Dark", then close.')).toEqual([
			'Choose "Theme: Dark",',
			"then close.",
		]);
		const long = splitNarrationLine(
			"This sentence has many words and should be broken into shorter readable chunks",
		);
		expect(long.length).toBeGreaterThan(1);
		expect(long.every((c) => c.length <= 28)).toBe(true);
		expect(long.join(" ")).toBe(
			"This sentence has many words and should be broken into shorter readable chunks",
		);
	});
	it("groups the subtitle chunks into whole sentences for the voice", () => {
		expect(splitNarrationSentences("先点击设置，然后打开菜单。接着保存！")).toEqual([
			{ text: "先点击设置，然后打开菜单。", chunks: ["先点击设置，", "然后打开菜单。"] },
			{ text: "接着保存！", chunks: ["接着保存！"] },
		]);
		// Decimals and web addresses do not end a sentence; a semicolon does.
		expect(splitNarrationSentences("Install 2.0, open github.com; then wait. Done")).toEqual([
			{
				text: "Install 2.0, open github.com;",
				chunks: ["Install 2.0,", "open github.com;"],
			},
			{ text: "then wait.", chunks: ["then wait."] },
			{ text: "Done", chunks: ["Done"] },
		]);
		expect(splitNarrationSentences("点击“Settings”打开设置，然后选择 Dark mode。")).toEqual([
			{
				text: "点击“Settings”打开设置，然后选择 Dark mode。",
				chunks: ["点击“Settings”打开设置，", "然后选择 Dark mode。"],
			},
		]);
		expect(splitNarrationSentences("  ")).toEqual([]);
	});
	it("maps narration clips from timeline time to source time, chunk by chunk", () => {
		const { cues, skipped } = narrationCaptions(
			state(),
			[region("s1", 1000, 3000), region("s2", 5000, 6000)],
			[
				{ id: "s1", text: "先点击，再保存。" },
				{ id: "s2", text: "Zoom in." },
			],
		);
		expect(skipped).toBe(0);
		expect(cues.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))).toEqual([
			{ startMs: 1000, endMs: 2000, text: "先点击，" },
			{ startMs: 2000, endMs: 3000, text: "再保存。" },
			// Timeline 5–6 s inside clip b = source 12–14 s.
			{ startMs: 12000, endMs: 14000, text: "Zoom in." },
		]);
		expect(new Set(cues.map((c) => c.id)).size).toBe(cues.length);
	});
	it("times each chunk by when the voice actually finishes saying it", () => {
		const { cues } = narrationCaptions(
			state(),
			[region("s1", 1000, 4000)],
			[{ id: "s1", text: "先点击设置（Settings），再保存。" }],
			{
				s1: [
					{ text: "先点击设置（Settings），", endMs: 1200 },
					{ text: "再保存。", endMs: 3000 },
				],
			},
		);
		expect(cues.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
			[1000, 2200],
			[2200, 4000],
		]);
	});
	it("lets a line cross a cut and skips only the chunks that hit existing subtitles", () => {
		const { cues, skipped } = narrationCaptions(
			state({ autoCaptions: [{ id: "x", startMs: 12500, endMs: 13000, text: "Hi" }] }),
			[region("s1", 3000, 5000), region("s2", 5000, 6000)],
			[
				{ id: "s1", text: "Across the cut, into the next clip" },
				{ id: "s2", text: "Overlaps" },
			],
			{
				s1: [
					{ text: "Across the cut,", endMs: 1000 },
					{ text: "into the next clip", endMs: 2000 },
				],
			},
		);
		// "into the next clip" starts in clip b (timeline 4 s = source 10 s) and still gets a subtitle.
		expect(cues.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))).toEqual([
			{ startMs: 3000, endMs: 4000, text: "Across the cut," },
			{ startMs: 10000, endMs: 12000, text: "into the next clip" },
		]);
		expect(skipped).toBe(1);
	});
	it("skips subtitles for a voice that plays after the video ends", () => {
		const { cues, skipped } = narrationCaptions(
			state(),
			[region("s1", 9000, 9500)],
			[{ id: "s1", text: "Bye." }],
		);
		expect(cues).toEqual([]);
		expect(skipped).toBe(1);
	});
});

it("keeps distinct story subtitles for repeated uses of the same source footage", async () => {
	const { projectCaptionCues } = await import("../captionTimeline");
	const s = state({
		clipRegions: [
			{ id: "first", startMs: 0, endMs: 4000, sourceStartMs: 0, speed: 1 },
			{ id: "second", startMs: 4000, endMs: 8000, sourceStartMs: 0, speed: 1 },
		],
	});
	const { cues, skipped } = narrationCaptions(
		s,
		[region("first", 1000, 2000), region("second", 5000, 6000)],
		[
			{ id: "first", text: "First scene." },
			{ id: "second", text: "Second scene." },
		],
	);
	expect(skipped).toBe(0);
	expect(cues.map((c) => c.clipId)).toEqual(["first", "second"]);
	expect(
		projectCaptionCues(cues, s.clipRegions).map((c) => [c.text, c.startMs, c.endMs]),
	).toEqual([
		["First scene.", 1000, 2000],
		["Second scene.", 5000, 6000],
	]);
});

it("splits a single spoken subtitle chunk across a source cut instead of losing its tail", () => {
	const { cues, skipped } = narrationCaptions(
		state(),
		[region("cross", 3000, 5000)],
		[{ id: "cross", text: "Across a cut." }],
		{ cross: [{ text: "Across a cut.", endMs: 2000 }] },
	);
	expect(skipped).toBe(0);
	expect(cues.map((c) => [c.clipId, c.startMs, c.endMs])).toEqual([
		["a", 3000, 4000],
		["b", 10000, 12000],
	]);
});

it("bound subtitles on another source reuse do not block this scene, but real speech does", () => {
	const repeated = [
		{ id: "first", startMs: 0, endMs: 4000, sourceStartMs: 0, speed: 1 },
		{ id: "second", startMs: 4000, endMs: 8000, sourceStartMs: 0, speed: 1 },
	];
	const s = state({
		clipRegions: repeated,
		autoCaptions: [
			{ id: "old", clipId: "first", startMs: 1000, endMs: 2000, text: "Only first" },
		],
	});
	expect(
		narrationCaptions(
			s,
			[region("second", 5000, 6000)],
			[{ id: "second", text: "Now second." }],
		).skipped,
	).toBe(0);
	expect(
		narrationCaptions(
			{
				...s,
				autoCaptions: [
					{ id: "speech", startMs: 1000, endMs: 2000, text: "Original speech" },
				],
			},
			[region("second", 5000, 6000)],
			[{ id: "second", text: "Now second." }],
		).skipped,
	).toBe(1);
});
