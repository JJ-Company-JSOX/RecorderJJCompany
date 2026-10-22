import { describe, expect, it } from "vitest";
import {
	boxesFromProbabilityMap,
	DETECTION_DEFAULTS,
	detectionInput,
	detectionInputSize,
	roundHalfEven,
	sortBoxes,
} from "./detection";

describe("OCR detection pre-processing", () => {
	it("rounds halves to even like Python", () => {
		expect([0.5, 1.5, 2.5, -1.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, -2, 2, 3]);
	});

	// Expected sizes from RapidOCR 3.10.0 DetPreProcess(736, "min").resize.
	it.each([
		[768, 432, 1312, 736],
		[1280, 720, 1312, 736],
		[1024, 576, 1312, 736],
		[1152, 648, 1312, 736],
		[853, 480, 1312, 736],
		[30, 400, 736, 9824],
		[2000, 100, 14720, 736],
		[737, 737, 736, 736],
		[100, 100, 736, 736],
	])("sizes %ix%i to %ix%i", (width, height, expectedWidth, expectedHeight) => {
		expect(detectionInputSize(width, height)).toEqual({
			width: expectedWidth,
			height: expectedHeight,
		});
	});

	it("limits the longest side when asked to", () => {
		expect(detectionInputSize(1280, 720, { limitSideLen: 960, limitType: "max" })).toEqual({
			width: 960,
			height: 544,
		});
		expect(detectionInputSize(10, 10, { limitSideLen: 960, limitType: "max" })).toBeNull();
	});

	it("builds a 1x3xHxW tensor for the resized image", () => {
		const image = { width: 64, height: 32, data: new Uint8Array(64 * 32 * 3).fill(255) };
		const input = detectionInput(image, { ...DETECTION_DEFAULTS, limitSideLen: 32 });
		expect(input && [input.width, input.height, input.data.length]).toEqual([
			64,
			32,
			64 * 32 * 3,
		]);
		expect(input?.data.every((value) => Math.abs(value - 1) < 1e-6)).toBe(true);
	});
});

describe("OCR DB post-processing", () => {
	// Probability map and expected boxes from RapidOCR 3.10.0 DBPostProcess(thresh 0.3,
	// box_thresh 0.5, unclip 1.6, dilation) + sorted_boxes, as axis-aligned bounds.
	const width = 64;
	const height = 48;
	const map = new Float32Array(width * height);
	const fill = (x0: number, y0: number, x1: number, y1: number, value: number) => {
		for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) map[y * width + x] = value;
	};
	fill(4, 5, 30, 10, 0.9);
	fill(40, 20, 60, 26, 0.8);
	fill(10, 30, 12, 32, 0.95); // too small
	fill(8, 36, 24, 44, 0.4); // above thresh, below box_thresh
	fill(30, 36, 50, 44, 0.7);

	it("finds, scores, expands and scales text regions like RapidOCR", () => {
		const boxes = sortBoxes(boxesFromProbabilityMap(map, width, height, 128, 80));
		expect(boxes.map((entry) => entry.box)).toEqual([
			[2, 3, 66, 22],
			[72, 27, 127, 50],
			[50, 52, 110, 79],
		]);
		expect(boxes.map((entry) => entry.score)).toEqual([
			expect.closeTo(0.7222, 4),
			expect.closeTo(0.6531, 4),
			expect.closeTo(0.5926, 4),
		]);
	});

	it("respects the candidate limit and the box threshold", () => {
		expect(
			boxesFromProbabilityMap(map, width, height, 128, 80, {
				...DETECTION_DEFAULTS,
				maxCandidates: 1,
			}),
		).toHaveLength(1);
		const strict = (boxThresh: number) =>
			sortBoxes(
				boxesFromProbabilityMap(map, width, height, 128, 80, {
					...DETECTION_DEFAULTS,
					boxThresh,
				}),
			).map((entry) => entry.box);
		expect(strict(0.6)).toEqual([
			[2, 3, 66, 22],
			[72, 27, 127, 50],
		]);
		expect(strict(0.75)).toEqual([]);
	});

	it("returns nothing for an empty map", () => {
		expect(boxesFromProbabilityMap(new Float32Array(16), 4, 4, 4, 4)).toEqual([]);
	});

	it("sorts rows top to bottom with a 10 px tolerance, then left to right", () => {
		const boxes = [
			{ box: [300, 105, 340, 120] as [number, number, number, number] },
			{ box: [10, 100, 60, 118] as [number, number, number, number] },
			{ box: [120, 108, 200, 125] as [number, number, number, number] },
			{ box: [5, 10, 50, 30] as [number, number, number, number] },
			{ box: [10, 140, 60, 160] as [number, number, number, number] },
		];
		expect(sortBoxes(boxes).map((entry) => entry.box[0])).toEqual([5, 10, 120, 300, 10]);
	});
});
