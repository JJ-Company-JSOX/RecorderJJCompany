import { describe, expect, it, vi } from "vitest";
import type { RgbImage } from "../ocrTypes";
import { OCR_DEFAULTS, type OcrInference, runOcr } from "./pipeline";
import { ctcCharacters } from "./recognition";

const characters = ctcCharacters("O\nK\nA\nB");
const CLASSES = characters.length;

/** White image with dark blocks; `rects` are [x0, y0, x1, y1] in image pixels. */
function image(width: number, height: number, rects: number[][]): RgbImage {
	const data = new Uint8Array(width * height * 3).fill(255);
	for (const [x0, y0, x1, y1] of rects)
		for (let y = y0; y < y1; y++) data.fill(20, (y * width + x0) * 3, (y * width + x1) * 3);
	return { width, height, data };
}

/**
 * Fake models: detection marks the given rectangles (in the coordinates of the image that
 * was handed to the pipeline after its own padding, `offsetY`) and recognition reads every
 * crop as `text` with probability `p`.
 */
function fakeInference(
	source: { width: number; height: number },
	rects: number[][],
	read: (crop: number) => { text: string; p: number },
	offsetY = 0,
	paddedHeight = source.height,
) {
	const crops: Array<{ batch: number; width: number }> = [];
	let seen = 0;
	const inference: OcrInference = {
		async detect(_data, width, height) {
			const map = new Float32Array(width * height);
			const sx = width / source.width;
			const sy = height / paddedHeight;
			for (const [x0, y0, x1, y1] of rects)
				for (
					let y = Math.round((y0 + offsetY) * sy);
					y < Math.round((y1 + offsetY) * sy);
					y++
				)
					for (let x = Math.round(x0 * sx); x < Math.round(x1 * sx); x++)
						map[y * width + x] = 0.9;
			return map;
		},
		async recognize(_data, batch, width) {
			crops.push({ batch, width });
			const steps = 8;
			const out = new Float32Array(batch * steps * CLASSES);
			for (let b = 0; b < batch; b++) {
				const { text, p } = read(seen++);
				for (let t = 0; t < steps; t++) {
					// Characters on even steps, blanks between them, blanks after the text.
					const char = t % 2 === 0 ? text[t / 2] : undefined;
					const index = char ? characters.indexOf(char) : 0;
					for (let c = 0; c < CLASSES; c++)
						out[(b * steps + t) * CLASSES + c] =
							c === index ? p : (1 - p) / (CLASSES - 1);
				}
			}
			return { data: out, steps, classes: CLASSES };
		},
	};
	return { inference, crops };
}

const contains = (box: number[], rect: number[], margin: number) =>
	box[0] <= rect[0] &&
	box[1] <= rect[1] &&
	box[2] >= rect[2] &&
	box[3] >= rect[3] &&
	box[0] >= rect[0] - margin &&
	box[1] >= rect[1] - margin &&
	box[2] <= rect[2] + margin &&
	box[3] <= rect[3] + margin;

describe("OCR pipeline", () => {
	it("returns text lines in reading order with boxes in input pixels", async () => {
		const rects = [
			[200, 20, 300, 40],
			[20, 22, 120, 40],
			[20, 70, 140, 90],
		];
		const input = image(320, 120, rects);
		const texts = ["OK", "AB", "KO"];
		const { inference } = fakeInference(input, rects, (i) => ({ text: texts[i], p: 0.9 }));
		const lines = await runOcr(input, inference, characters);
		expect(lines.map((line) => line.text).sort()).toEqual(["AB", "KO", "OK"]);
		// Reading order: the first row left to right, then the second row.
		const boxes = lines.map((line) => line.box);
		expect(contains(boxes[0], rects[1], 14)).toBe(true);
		expect(contains(boxes[1], rects[0], 14)).toBe(true);
		expect(contains(boxes[2], rects[2], 14)).toBe(true);
		expect(lines.every((line) => line.score === 0.9)).toBe(true);
	});

	it("drops empty and low-confidence lines", async () => {
		const rects = [
			[20, 20, 120, 40],
			[20, 70, 140, 90],
			[180, 70, 300, 90],
		];
		const input = image(320, 120, rects);
		const reads = [
			{ text: "OK", p: 0.9 },
			{ text: "AB", p: 0.3 },
			{ text: "", p: 0.9 },
		];
		const { inference } = fakeInference(input, rects, (i) => reads[i]);
		expect((await runOcr(input, inference, characters)).map((line) => line.text)).toEqual([
			"OK",
		]);
	});

	it("maps boxes back through the padding of a very flat image", async () => {
		// 800x40 is wider than 8:1, so RapidOCR pads it to 800x200 (80 black rows on top).
		const rects = [[100, 12, 300, 30]];
		const input = image(800, 40, rects);
		const { inference } = fakeInference(input, rects, () => ({ text: "OK", p: 0.95 }), 80, 200);
		const [line] = await runOcr(input, inference, characters);
		expect(line.text).toBe("OK");
		expect(contains(line.box, rects[0], 14)).toBe(true);
		expect(line.box[1]).toBeGreaterThanOrEqual(0);
		expect(line.box[3]).toBeLessThanOrEqual(40);
	});

	it("maps boxes back through the shrink of a very large image", async () => {
		const rects = [[400, 300, 1600, 380]];
		const input = image(2400, 1200, rects);
		const { inference } = fakeInference(input, rects, () => ({ text: "AB", p: 0.9 }));
		const [line] = await runOcr(input, inference, characters);
		expect(line.text).toBe("AB");
		// Scaled back by 2400/1984; the unclip margin grows with the text height (about 60 px).
		expect(line.box).toEqual([340, 240, 1661, 440]);
	});

	it("reads items separated by a wide gap as separate lines", async () => {
		// One detected region spanning two dark items 40 px apart (18 px tall).
		const input = image(320, 80, [
			[20, 30, 60, 48],
			[100, 30, 140, 48],
		]);
		const reads = ["OK", "AB"];
		const { inference, crops } = fakeInference(input, [[20, 30, 140, 48]], (i) => ({
			text: reads[i],
			p: 0.9,
		}));
		const lines = await runOcr(input, inference, characters);
		expect(lines.map((line) => line.text)).toEqual(["OK", "AB"]);
		expect(lines[0].box[2]).toBeLessThanOrEqual(lines[1].box[0]);
		expect(crops).toEqual([{ batch: 2, width: 320 }]);
		const joined = await runOcr(
			input,
			fakeInference(input, [[20, 30, 140, 48]], () => ({
				text: "OK",
				p: 0.9,
			})).inference,
			characters,
			{ ...OCR_DEFAULTS, gapSplitRatio: 0 },
		);
		expect(joined).toHaveLength(1);
	});

	it("skips recognition when nothing is detected", async () => {
		const input = image(64, 64, []);
		const recognize = vi.fn();
		const lines = await runOcr(
			input,
			{ detect: async (_d, w, h) => new Float32Array(w * h), recognize },
			characters,
		);
		expect(lines).toEqual([]);
		expect(recognize).not.toHaveBeenCalled();
	});
});
