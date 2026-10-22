import { describe, expect, it } from "vitest";
import {
	ctcCharacters,
	ctcDecode,
	REC_HEIGHT,
	recognitionBatches,
	recognitionInput,
} from "./recognition";

/** One-hot-ish [steps, classes] rows: each step puts `p` on its class and spreads the rest. */
function probabilities(rows: Array<[number, number]>, classes: number) {
	const data = new Float32Array(rows.length * classes);
	rows.forEach(([index, p], step) => {
		for (let c = 0; c < classes; c++)
			data[step * classes + c] = c === index ? p : (1 - p) / (classes - 1);
	});
	return data;
}

describe("OCR recognition post-processing", () => {
	it("builds the CTC table: blank first, the dictionary, then a space", () => {
		expect(ctcCharacters("a\r\nb\nc\n")).toEqual(["blank", "a", "b", "c", " "]);
		expect(ctcCharacters("文\n件")).toEqual(["blank", "文", "件", " "]);
	});

	it("collapses repeats, drops blanks and averages the kept probabilities", () => {
		const characters = ctcCharacters("O\nK");
		const steps: Array<[number, number]> = [
			[0, 0.9],
			[1, 0.8],
			[1, 0.99],
			[0, 0.9],
			[2, 0.6],
			[0, 0.9],
			[2, 0.7],
			[3, 0.95],
		];
		const [result] = ctcDecode(probabilities(steps, 4), 1, steps.length, 4, characters);
		// O (0.8), K (0.6), K again after a blank (0.7), space (0.95).
		expect(result.text).toBe("OKK ");
		expect(result.score).toBeCloseTo((0.8 + 0.6 + 0.7 + 0.95) / 4, 5);
	});

	it("decodes each batch item separately and scores empty lines 0", () => {
		const characters = ctcCharacters("a");
		const data = new Float32Array([
			...probabilities(
				[
					[1, 0.9],
					[0, 0.9],
				],
				3,
			),
			...probabilities(
				[
					[0, 0.9],
					[0, 0.9],
				],
				3,
			),
		]);
		expect(ctcDecode(data, 2, 2, 3, characters)).toEqual([
			{ text: "a", score: 0.9 },
			{ text: "", score: 0 },
		]);
	});

	it("refuses a dictionary that does not match the model", () => {
		expect(() => ctcDecode(new Float32Array(5), 1, 1, 5, ctcCharacters("a"))).toThrow(
			/dictionary/,
		);
	});
});

describe("OCR recognition pre-processing", () => {
	const crop = (width: number, height: number, value = 255) => ({
		width,
		height,
		data: new Uint8Array(width * height * 3).fill(value),
	});

	it("batches by width/height ratio, at most six at a time", () => {
		const crops = [crop(100, 10), crop(20, 10), crop(50, 10), ...Array(5).fill(crop(30, 10))];
		expect(recognitionBatches(crops)).toEqual([
			[1, 3, 4, 5, 6, 7],
			[2, 0],
		]);
	});

	it("resizes to 48 px high, keeps the aspect ratio and pads to the batch width", () => {
		const input = recognitionInput([crop(24, 12), crop(240, 12, 0)]);
		// The widest crop is 20:1, so the batch is 960 px wide; never narrower than 320.
		expect(input.width).toBe(960);
		expect(input.batch).toBe(2);
		const plane = REC_HEIGHT * input.width;
		expect(input.data.length).toBe(2 * 3 * plane);
		// First crop: 96 px of white (1.0), then zero padding.
		expect(input.data[95]).toBeCloseTo(1, 6);
		expect(input.data[96]).toBe(0);
		// Second crop fills the whole width with black (-1).
		expect(input.data[3 * plane + 959]).toBeCloseTo(-1, 6);
		expect(recognitionInput([crop(10, 10)]).width).toBe(320);
	});
});
