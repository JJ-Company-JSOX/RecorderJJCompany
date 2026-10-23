import { describe, expect, it } from "vitest";
import { speechLanguage, speechSegments } from "./speechText";

describe("text to speech segments", () => {
	it("reads every paragraph as its own line and drops blank ones", () => {
		expect(speechSegments("  First   line. \n\n\nSecond line.\r\n第三行。  ")).toEqual([
			"First line.",
			"Second line.",
			"第三行。",
		]);
		expect(speechSegments(" \n\t ")).toEqual([]);
	});

	it("splits a long paragraph at sentence ends without losing text", () => {
		const sentence = "这是一个用来测试长段落切分的句子，内容需要足够长。";
		const paragraph = sentence.repeat(30);
		const segments = speechSegments(paragraph, 100);
		expect(segments.length).toBeGreaterThan(1);
		expect(segments.every((segment) => segment.length <= 100)).toBe(true);
		expect(segments.every((segment) => segment.endsWith("。"))).toBe(true);
		expect(segments.join("")).toBe(paragraph);
	});

	it("breaks one very long sentence at its subtitle breaks", () => {
		const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
		const segments = speechSegments(words, 80);
		expect(segments.length).toBeGreaterThan(1);
		expect(segments.every((segment) => segment.length <= 80)).toBe(true);
		expect(segments.join(" ")).toBe(words);
	});

	it("picks the Chinese voice when the text has Chinese characters", () => {
		expect(speechLanguage("点击 Settings 打开设置")).toBe("zh");
		expect(speechLanguage("Open the Settings page.")).toBe("en");
	});
});
