import { describe, expect, it } from "vitest";
import type { RgbImage } from "../ocrTypes";
import { splitAtGaps } from "./gaps";

/** A light background with dark "glyph" blocks, each [x0, x1) wide and 14 px tall at y 10. */
function line(blocks: Array<[number, number]>, options: { ink?: number; width?: number } = {}) {
	const width = options.width ?? 200;
	const height = 34;
	const data = new Uint8Array(width * height * 3).fill(245);
	for (const [x0, x1] of blocks)
		for (let y = 10; y < 24; y++)
			for (let x = x0; x < x1; x++)
				data.fill(options.ink ?? 30, (y * width + x) * 3, (y * width + x) * 3 + 3);
	return { width, height, data } satisfies RgbImage;
}

describe("OCR gap split", () => {
	it("cuts a line where the blank run is wider than the text is tall", () => {
		// Two "menu items" 26 px apart (text 14 px tall).
		const image = line([
			[10, 24],
			[26, 40],
			[66, 80],
			[82, 96],
		]);
		expect(splitAtGaps(image, [0, 0, 120, 34], 1)).toEqual([
			[0, 0, 53, 34],
			[53, 0, 120, 34],
		]);
	});

	it("keeps word spaces and punctuation gaps together", () => {
		// 4-9 px gaps: well under one text height.
		const image = line([
			[10, 30],
			[34, 60],
			[69, 90],
		]);
		expect(splitAtGaps(image, [0, 0, 120, 34], 1)).toEqual([[0, 0, 120, 34]]);
	});

	it("does not split off a thin border or caret", () => {
		const image = line([
			[10, 60],
			[100, 102],
		]);
		expect(splitAtGaps(image, [0, 0, 120, 34], 1)).toEqual([[0, 0, 120, 34]]);
	});

	it("splits into several items and works on dark themes", () => {
		const width = 260;
		const image = line(
			[
				[10, 40],
				[70, 100],
				[130, 160],
				[190, 220],
			],
			{ width },
		);
		for (let i = 0; i < image.data.length; i++) image.data[i] = 255 - image.data[i];
		expect(splitAtGaps(image, [0, 0, width, 34], 1)).toHaveLength(4);
	});

	it("leaves boxes alone when disabled, too short, vertical or without contrast", () => {
		const image = line([
			[10, 24],
			[66, 80],
		]);
		expect(splitAtGaps(image, [0, 0, 120, 34], 0)).toEqual([[0, 0, 120, 34]]);
		expect(splitAtGaps(image, [0, 0, 60, 34], 1)).toEqual([[0, 0, 60, 34]]);
		expect(splitAtGaps(line([]), [0, 0, 120, 34], 1)).toEqual([[0, 0, 120, 34]]);
		expect(
			splitAtGaps(
				line(
					[
						[10, 24],
						[66, 80],
					],
					{ ink: 240 },
				),
				[0, 0, 120, 34],
				1,
			),
		).toEqual([[0, 0, 120, 34]]);
	});

	it("measures the gap against the text height inside the box only", () => {
		const image = line([
			[110, 124],
			[150, 164],
		]);
		const pieces = splitAtGaps(image, [100, 0, 180, 34], 1);
		expect(pieces).toEqual([
			[100, 0, 137, 34],
			[137, 0, 180, 34],
		]);
	});
});
