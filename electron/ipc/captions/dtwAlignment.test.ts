import { expect, it } from "vitest";
import { alignWhisperDtwSpeech } from "./dtwAlignment";

const token = (text: string, t_dtw?: number, p?: number) => ({
	text,
	t_dtw,
	p,
	offsets: { from: 4330, to: 4330 },
});
const segment = (text: string, tokens: ReturnType<typeof token>[]) => ({ text, tokens });
const align = (
	segments: unknown[],
	silences = [
		{ startMs: 1500, endMs: 4300 },
		{ startMs: 5800, endMs: 6600 },
	],
	duration = 9000,
) => alignWhisperDtwSpeech(JSON.stringify({ transcription: segments }), silences, duration);

it("locates repeated speech from real monotonic DTW anchors despite broken heuristic offsets", () => {
	const result = align([
		segment("Click the blue save button.", [
			token(" Click", 30, 0.77),
			token(" blue", 72, 0.76),
			token(" button", 146, 0.99),
			token(".", 332, 0.2),
		]),
		segment("Click the blue save button.", [
			token(" Click", 454, 0.94),
			token(" blue", 498, 0.97),
			token(" button", 564, 0.99),
		]),
	]);
	expect(result.get("caption-2")).toMatchObject({
		startMs: 4220,
		endMs: 5880,
		text: "Click the blue save button.",
		alignment: "dtw-speech",
		confidence: (0.94 + 0.97 + 0.99) / 3,
	});
	expect(result.get("caption-1")?.confidence).toBeCloseTo((0.77 + 0.76 + 0.99) / 3);
	expect(result.get("caption-1")).not.toHaveProperty("words");
});
it("rejects missing, nonmonotonic, silence, or multi-component speech anchors", () => {
	for (const tokens of [
		[token(" first", undefined, 0.99)],
		[token(" first", 80, 0.99), token(" last", 30, 0.99)],
		[token(" silence", 300, 0.99)],
		[token(" first", 50, 0.99), token(" last", 450, 0.99)],
	])
		expect(align([segment("Unsafe", tokens)]).size).toBe(0);
});

it("rejects backwards anchors across segments and malformed acoustic intervals", () => {
	expect(
		align([
			segment("Later", [token(" later", 500, 0.9)]),
			segment("Earlier", [token(" earlier", 50, 0.9)]),
		]).size,
	).toBe(0);
	expect(
		align([segment("One", [token(" one", 50, 0.9)])], [{ startMs: NaN, endMs: 2000 }]).size,
	).toBe(0);
});
it("refuses two segments in one acoustic component including a partially invalid competitor", () => {
	expect(
		align([segment("One", [token(" one", 30, 0.9)]), segment("Two", [token(" two", 80, 0.9)])])
			.size,
	).toBe(0);
	expect(
		align([
			segment("One", [token(" one", 30, 0.9)]),
			segment("Two", [token(" two", 80, 0.9), token(" missing", undefined, 0.9)]),
		]).size,
	).toBe(0);
});
it("preserves original CJK segment text and requires real complete probability coverage", () => {
	const result = align([
		segment("离线视频编辑器。", [
			token("\uFFFD", 20, 0.9),
			token("\uFFFD", 80),
			token("。", 300, 0),
		]),
	]);
	expect(result.get("caption-1")).toMatchObject({
		text: "离线视频编辑器。",
		alignment: "dtw-speech",
	});
	expect(result.get("caption-1")).not.toHaveProperty("confidence");
});
it("never aligns malformed or missing JSON/duration and excludes all control/punctuation anchors", () => {
	expect(alignWhisperDtwSpeech("not JSON", [], 9000).size).toBe(0);
	expect(align([], [], NaN).size).toBe(0);
	expect(
		align([
			segment("No lexical speech", [
				token("[_BEG_]", 300, 1),
				token("!", 300, 1),
				token(" ", 300, 1),
			]),
		]).size,
	).toBe(0);
});
