import { describe, expect, it } from "vitest";
import { NarrationAudioCache, type NarrationAudioClip } from "./narrationAudioCache";
const line = (id = "a", text = "Hello world") => ({ id, text });
const clip = (patch: Partial<NarrationAudioClip> = {}): NarrationAudioClip => ({
	id: "a",
	audioPath: "/speech.wav",
	durationMs: 1200,
	chunks: [
		{ text: "Hello", endMs: 500 },
		{ text: "world", endMs: 1200 },
	],
	...patch,
});
describe("session narration synthesis reuse", () => {
	it("keys actual text, language and selected voice rather than placement or cue ID", () => {
		const cache = new NarrationAudioCache();
		cache.remember([line()], [clip()], "en", 3);
		expect(cache.get(line("moved-to-new-scene"), "en", 3)).toMatchObject({
			id: "moved-to-new-scene",
			audioPath: "/speech.wav",
			durationMs: 1200,
		});
		expect(cache.get(line("a", "Edited wording"), "en", 3)).toBeUndefined();
		expect(cache.get(line(), "zh", 3)).toBeUndefined();
		expect(cache.get(line(), "en", 16)).toBeUndefined();
		expect(cache.get(line(), "en")).toBeUndefined();
	});
	it("normalizes only surrounding whitespace and distinguishes a default voice from zero", () => {
		const cache = new NarrationAudioCache();
		cache.remember([line("a", "  Hello world  ")], [clip()], "en");
		expect(cache.get(line(), "en")).toBeDefined();
		expect(cache.get(line(), "en", 0)).toBeUndefined();
		expect(cache.get(line("a", "Hello  world"), "en")).toBeUndefined();
	});
	it("clones stored and returned chunks so renderer edits cannot corrupt later reuse", () => {
		const cache = new NarrationAudioCache(),
			original = clip();
		cache.remember([line()], [original], "en", 3);
		original.audioPath = "/mutated.wav";
		original.chunks![0].text = "mutated input";
		const first = cache.get(line("first"), "en", 3)!;
		expect(first).toMatchObject({
			id: "first",
			audioPath: "/speech.wav",
			chunks: [
				{ text: "Hello", endMs: 500 },
				{ text: "world", endMs: 1200 },
			],
		});
		first.chunks![0].endMs = 99;
		first.audioPath = "/mutated-output.wav";
		expect(cache.get(line("second"), "en", 3)).toMatchObject({
			id: "second",
			audioPath: "/speech.wav",
			chunks: [
				{ text: "Hello", endMs: 500 },
				{ text: "world", endMs: 1200 },
			],
		});
	});
	it("bounds session memory to the latest 64 remembered text/voice combinations", () => {
		const cache = new NarrationAudioCache();
		for (let i = 0; i < 66; i++)
			cache.remember(
				[line(`cue-${i}`, `Sentence ${i}`)],
				[clip({ id: `cue-${i}`, audioPath: `/speech-${i}.wav` })],
				"en",
				3,
			);
		expect(cache.get(line("lookup", "Sentence 0"), "en", 3)).toBeUndefined();
		expect(cache.get(line("lookup", "Sentence 1"), "en", 3)).toBeUndefined();
		expect(cache.get(line("lookup", "Sentence 2"), "en", 3)?.audioPath).toBe("/speech-2.wav");
		expect(cache.get(line("lookup", "Sentence 65"), "en", 3)?.audioPath).toBe("/speech-65.wav");
	});
	it("ignores unrelated synthesis IDs, empty paths and nonpositive/nonfinite durations", () => {
		const cache = new NarrationAudioCache();
		for (const invalid of [
			clip({ id: "unknown" }),
			clip({ audioPath: "" }),
			clip({ durationMs: 0 }),
			clip({ durationMs: -1 }),
			clip({ durationMs: NaN }),
			clip({ durationMs: Infinity }),
		])
			cache.remember([line()], [invalid], "en", 3);
		expect(cache.get(line(), "en", 3)).toBeUndefined();
		cache.remember([line()], [clip()], "en", 3);
		expect(cache.get(line(), "en", 3)).toBeDefined();
	});
	it("replaces a repeated successful synthesis and can clear every voice/language entry", () => {
		const cache = new NarrationAudioCache();
		cache.remember([line()], [clip()], "en", 3);
		cache.remember([line()], [clip({ audioPath: "/new.wav", durationMs: 900 })], "en", 3);
		cache.remember([line()], [clip()], "zh", 3);
		expect(cache.get(line(), "en", 3)).toMatchObject({
			audioPath: "/new.wav",
			durationMs: 900,
		});
		cache.clear();
		expect(cache.get(line(), "en", 3)).toBeUndefined();
		expect(cache.get(line(), "zh", 3)).toBeUndefined();
	});
});
