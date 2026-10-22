import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	assertRgbImage,
	cropRgb,
	padVertical,
	resizeBilinear,
	rotate90,
	writeNormalizedBgr,
} from "./image";

// Expected bytes were produced with OpenCV 5.0 (cv2.resize INTER_LINEAR) and np.rot90.
const source = {
	width: 4,
	height: 3,
	data: Uint8Array.from([
		139, 74, 229, 241, 169, 65, 6, 160, 149, 106, 38, 175, 188, 205, 175, 229, 98, 249, 10, 148,
		95, 86, 147, 198, 66, 39, 106, 213, 171, 45, 167, 57, 69, 81, 55, 14,
	]),
};

describe("OCR image helpers", () => {
	it("enlarges exactly like cv2.resize INTER_LINEAR", () => {
		expect(Array.from(resizeBilinear(source, 7, 5).data)).toEqual([
			139, 74, 229, 175, 108, 170, 234, 162, 77, 123, 164, 107, 13, 151, 151, 70, 81, 166,
			106, 38, 175, 158, 126, 207, 186, 131, 183, 231, 139, 143, 122, 148, 133, 14, 150, 131,
			66, 108, 164, 98, 82, 184, 188, 205, 175, 203, 167, 201, 226, 106, 244, 120, 123, 172,
			15, 148, 102, 59, 147, 161, 86, 147, 198, 115, 105, 133, 152, 118, 131, 212, 139, 127,
			162, 117, 103, 103, 93, 80, 91, 92, 84, 83, 92, 87, 66, 39, 106, 118, 86, 84, 202, 161,
			49, 190, 114, 57, 161, 57, 65, 112, 56, 33, 81, 55, 14,
		]);
	});

	it("shrinks exactly like cv2.resize INTER_LINEAR", () => {
		expect(Array.from(resizeBilinear(source, 3, 2).data)).toEqual([
			165, 114, 198, 122, 154, 123, 85, 80, 173, 116, 92, 119, 172, 116, 86, 90, 78, 62,
		]);
		expect(resizeBilinear(source, 4, 3)).toBe(source);
	});

	// A deterministic pattern; the hashes are of cv2.resize(pattern, (w, h)) with OpenCV 5.0.
	it.each([
		[64, 36, 128, 72, "4d5a3998396faf629ff0f66c6611e1481d2b13faeb3af62e3bda8af49321a581"],
		[200, 30, 320, 48, "cd84f2e8f72ff52b7e8d82c1aa6fde3abf33bc28fad9751e46d60c13ead7b4a0"],
		[100, 60, 64, 40, "1d9fc65d33ba205a6f992cf26c1d150b1b72059fd25629798ee025c7d8f3a6f6"],
	])("matches cv2.resize bit for bit, %ix%i to %ix%i", (width, height, toWidth, toHeight, sha256) => {
		const data = new Uint8Array(width * height * 3);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				for (let c = 0; c < 3; c++)
					data[(y * width + x) * 3 + c] =
						(x * 37 + y * 101 + c * 59 + ((x * y) % 23) * 11) % 256;
		const resized = resizeBilinear({ width, height, data }, toWidth, toHeight);
		expect(createHash("sha256").update(resized.data).digest("hex")).toBe(sha256);
	});

	it("turns a quarter counter-clockwise like np.rot90", () => {
		const turned = rotate90(source);
		expect([turned.width, turned.height]).toEqual([3, 4]);
		expect(Array.from(turned.data)).toEqual([
			106, 38, 175, 86, 147, 198, 81, 55, 14, 6, 160, 149, 10, 148, 95, 167, 57, 69, 241, 169,
			65, 229, 98, 249, 213, 171, 45, 139, 74, 229, 188, 205, 175, 66, 39, 106,
		]);
	});

	it("crops and pads with black rows", () => {
		const crop = cropRgb(source, 1, 1, 2, 2);
		expect(Array.from(crop.data)).toEqual([
			229, 98, 249, 10, 148, 95, 213, 171, 45, 167, 57, 69,
		]);
		const padded = padVertical(crop, 1);
		expect([padded.width, padded.height]).toEqual([2, 4]);
		expect(Array.from(padded.data.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
		expect(Array.from(padded.data.subarray(6, 18))).toEqual(Array.from(crop.data));
		expect(Array.from(padded.data.subarray(18))).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it("normalises to planar BGR in [-1, 1], as the models were trained", () => {
		const pixel = { width: 1, height: 1, data: Uint8Array.from([0, 255, 51]) };
		const out = new Float32Array(3);
		writeNormalizedBgr(pixel, out);
		expect(out[0]).toBeCloseTo(51 / 127.5 - 1, 6);
		expect(out[1]).toBeCloseTo(1, 6);
		expect(out[2]).toBeCloseTo(-1, 6);
	});

	it("rejects malformed images", () => {
		expect(() => assertRgbImage({ width: 2, height: 2, data: new Uint8Array(11) })).toThrow(
			/RGB24/,
		);
		expect(() =>
			assertRgbImage({ width: 0, height: 2, data: new Uint8Array(0) } as never),
		).toThrow();
		expect(() => assertRgbImage({ width: 1, height: 1, data: [1, 2, 3] } as never)).toThrow();
		expect(() => assertRgbImage(source)).not.toThrow();
	});
});
