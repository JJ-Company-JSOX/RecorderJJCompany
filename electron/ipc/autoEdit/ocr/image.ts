// Pixel helpers for the bundled OCR engine. They reproduce the OpenCV calls RapidOCR makes
// (cv2.resize INTER_LINEAR, copyMakeBorder, np.rot90), so the models see the same input.
import type { RgbImage } from "../ocrTypes";

const COEF_SCALE = 1 << 11;

/** cvRound / saturate_cast<short>: halves go to the even neighbour. */
function roundEven(value: number) {
	const floor = Math.floor(value);
	const diff = value - floor;
	return diff > 0.5 || (diff === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
}

export function assertRgbImage(image: RgbImage) {
	if (
		!Number.isSafeInteger(image?.width) ||
		!Number.isSafeInteger(image?.height) ||
		image.width < 1 ||
		image.height < 1 ||
		!(image.data instanceof Uint8Array) ||
		image.data.length !== image.width * image.height * 3
	)
		throw new Error("OCR input must be an RGB24 image of width * height * 3 bytes.");
}

/**
 * Source taps and 11-bit weights per output position, computed as cv::resize does: a double
 * scale, a float32 fraction, cvRound weights. Columns past an edge snap to it (weight 0 on the
 * far tap); rows keep their fraction and clamp both source rows instead.
 */
function taps(source: number, target: number, snapEdges: boolean) {
	const offsets = new Int32Array(target * 2);
	const weights = new Int32Array(target * 2);
	const scale = 1 / (target / source);
	for (let i = 0; i < target; i++) {
		let f = Math.fround((i + 0.5) * scale - 0.5);
		let s = Math.floor(f);
		f = Math.fround(f - s);
		if (snapEdges && s < 0) {
			s = 0;
			f = 0;
		}
		if (snapEdges && s >= source - 1) {
			s = source - 1;
			f = 0;
		}
		offsets[i * 2] = Math.min(Math.max(s, 0), source - 1);
		offsets[i * 2 + 1] = Math.min(Math.max(s + 1, 0), source - 1);
		weights[i * 2] = roundEven(Math.fround(1 - f) * COEF_SCALE);
		weights[i * 2 + 1] = roundEven(f * COEF_SCALE);
	}
	return { offsets, weights };
}

/**
 * cv2.resize(INTER_LINEAR) for 8-bit RGB, bit for bit: an exact horizontal pass, then
 * OpenCV's SIMD vertical pass, which rounds as ((a >> 4) * wa >> 16) + ((b >> 4) * wb >> 16)
 * and a final (x + 2) >> 2. Verified against OpenCV 5.0 on frame-sized random images.
 */
export function resizeBilinear(image: RgbImage, width: number, height: number): RgbImage {
	if (width === image.width && height === image.height) return image;
	const { data: src, width: sw } = image;
	const x = taps(sw, width, true);
	const y = taps(image.height, height, false);
	const rowCache = new Map<number, Int32Array>();
	const horizontal = (row: number) => {
		let line = rowCache.get(row);
		if (line) return line;
		line = new Int32Array(width * 3);
		const base = row * sw * 3;
		for (let i = 0; i < width; i++) {
			const a = x.weights[i * 2];
			const b = x.weights[i * 2 + 1];
			const p = base + x.offsets[i * 2] * 3;
			const q = base + x.offsets[i * 2 + 1] * 3;
			// Rows are shifted right by 4 here once, as the vertical pass would per use.
			line[i * 3] = (src[p] * a + src[q] * b) >> 4;
			line[i * 3 + 1] = (src[p + 1] * a + src[q + 1] * b) >> 4;
			line[i * 3 + 2] = (src[p + 2] * a + src[q + 2] * b) >> 4;
		}
		if (rowCache.size > 3) rowCache.clear();
		rowCache.set(row, line);
		return line;
	};
	const data = new Uint8Array(width * height * 3);
	for (let j = 0; j < height; j++) {
		const a = y.weights[j * 2];
		const b = y.weights[j * 2 + 1];
		const top = horizontal(y.offsets[j * 2]);
		const bottom = horizontal(y.offsets[j * 2 + 1]);
		const out = j * width * 3;
		for (let i = 0; i < width * 3; i++)
			data[out + i] = (((top[i] * a) >> 16) + ((bottom[i] * b) >> 16) + 2) >> 2;
	}
	return { width, height, data };
}

/** Copies a rectangle; the caller keeps it inside the image. */
export function cropRgb(image: RgbImage, x: number, y: number, width: number, height: number) {
	const data = new Uint8Array(width * height * 3);
	for (let row = 0; row < height; row++) {
		const from = ((y + row) * image.width + x) * 3;
		data.set(image.data.subarray(from, from + width * 3), row * width * 3);
	}
	return { width, height, data };
}

/** np.rot90(image): a quarter turn counter-clockwise. */
export function rotate90(image: RgbImage): RgbImage {
	const { width, height } = image;
	const data = new Uint8Array(width * height * 3);
	for (let row = 0; row < width; row++)
		for (let column = 0; column < height; column++) {
			const from = (column * width + (width - 1 - row)) * 3;
			const to = (row * height + column) * 3;
			data[to] = image.data[from];
			data[to + 1] = image.data[from + 1];
			data[to + 2] = image.data[from + 2];
		}
	return { width: height, height: width, data };
}

/** cv2.copyMakeBorder with black rows above and below. */
export function padVertical(image: RgbImage, rows: number): RgbImage {
	const data = new Uint8Array(image.width * (image.height + rows * 2) * 3);
	data.set(image.data, image.width * rows * 3);
	return { width: image.width, height: image.height + rows * 2, data };
}

/**
 * Writes (pixel / 255 - 0.5) / 0.5 as planar BGR into `target` at `offset`, `stride` pixels per row.
 * RapidOCR converts every input to BGR before inference; the models were trained that way.
 */
export function writeNormalizedBgr(
	image: RgbImage,
	target: Float32Array,
	offset = 0,
	stride = image.width,
	planeSize = image.width * image.height,
) {
	const { width, height, data } = image;
	for (let row = 0; row < height; row++)
		for (let column = 0; column < width; column++) {
			const from = (row * width + column) * 3;
			const to = offset + row * stride + column;
			target[to] = data[from + 2] / 127.5 - 1;
			target[to + planeSize] = data[from + 1] / 127.5 - 1;
			target[to + planeSize * 2] = data[from] / 127.5 - 1;
		}
}
