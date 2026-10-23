// Text detection pre/post-processing, ported from RapidOCR 3.10.0 (rapidocr/ch_ppocr_det),
// Apache-2.0, Copyright (c) 2020 PaddlePaddle Authors and (c) 2021 RapidOCR Authors.
// Changed for Jsox: rewritten in TypeScript; boxes are axis-aligned rectangles taken from
// 8-connected components (UI text is horizontal), so OpenCV, pyclipper and shapely are not needed.
import type { RgbImage } from "../ocrTypes";
import { resizeBilinear, writeNormalizedBgr } from "./image";

export type DetectionOptions = {
	limitSideLen: number;
	limitType: "min" | "max";
	thresh: number;
	boxThresh: number;
	maxCandidates: number;
	unclipRatio: number;
	useDilation: boolean;
};

/** RapidOCR config.yaml `Det` defaults. */
export const DETECTION_DEFAULTS: DetectionOptions = {
	limitSideLen: 736,
	limitType: "min",
	thresh: 0.3,
	boxThresh: 0.5,
	maxCandidates: 1000,
	unclipRatio: 1.6,
	useDilation: true,
};

const MIN_SIZE = 3;
const SORT_Y_THRESHOLD = 10;

export type Box = [number, number, number, number];
export type DetectedBox = { box: Box; score: number };

/** Python round() / np.round(): halves go to the even neighbour. */
export function roundHalfEven(value: number) {
	const floor = Math.floor(value);
	const diff = value - floor;
	if (diff > 0.5) return floor + 1;
	if (diff < 0.5) return floor;
	return floor % 2 === 0 ? floor : floor + 1;
}

/** Clipper's Round(): halves away from zero. */
const clipperRound = (value: number) =>
	value < 0 ? Math.trunc(value - 0.5) : Math.trunc(value + 0.5);

/** DetPreProcess.resize: limit one side, then snap both to a multiple of 32. */
export function detectionInputSize(
	width: number,
	height: number,
	options: Pick<DetectionOptions, "limitSideLen" | "limitType"> = DETECTION_DEFAULTS,
) {
	const { limitSideLen, limitType } = options;
	let ratio = 1;
	if (limitType === "max") {
		if (Math.max(height, width) > limitSideLen)
			ratio = limitSideLen / (height > width ? height : width);
	} else if (Math.min(height, width) < limitSideLen) {
		ratio = limitSideLen / (height < width ? height : width);
	}
	const h = roundHalfEven(Math.trunc(height * ratio) / 32) * 32;
	const w = roundHalfEven(Math.trunc(width * ratio) / 32) * 32;
	return w > 0 && h > 0 ? { width: w, height: h } : null;
}

/** Resized, normalised 1x3xHxW BGR tensor data, or null when the image is too small. */
export function detectionInput(image: RgbImage, options: DetectionOptions = DETECTION_DEFAULTS) {
	const size = detectionInputSize(image.width, image.height, options);
	if (!size) return null;
	const resized = resizeBilinear(image, size.width, size.height);
	const data = new Float32Array(3 * size.width * size.height);
	writeNormalizedBgr(resized, data);
	return { data, ...size };
}

/**
 * DBPostProcess for a 1x1xHxW probability map. Returns boxes in `destWidth` x `destHeight`
 * pixels (the image that was resized for detection), already clipped and size-filtered.
 */
export function boxesFromProbabilityMap(
	probabilities: Float32Array,
	width: number,
	height: number,
	destWidth: number,
	destHeight: number,
	options: DetectionOptions = DETECTION_DEFAULTS,
): DetectedBox[] {
	const size = width * height;
	let bitmap = new Uint8Array(size);
	for (let i = 0; i < size; i++) bitmap[i] = probabilities[i] > options.thresh ? 1 : 0;
	if (options.useDilation) {
		// cv2.dilate with a 2x2 kernel: anchor (1, 1), so each pixel takes its up/left neighbours.
		const dilated = new Uint8Array(size);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const i = y * width + x;
				dilated[i] =
					bitmap[i] |
					(x > 0 ? bitmap[i - 1] : 0) |
					(y > 0 ? bitmap[i - width] : 0) |
					(x > 0 && y > 0 ? bitmap[i - width - 1] : 0);
			}
		bitmap = dilated;
	}

	// Outer contours of 8-connected components (cv2.findContours). Hole contours, which
	// RETR_LIST would also return, lie inside their component's box and are not emitted.
	const label = new Int32Array(size);
	const stack = new Int32Array(size);
	const regions: Box[] = [];
	for (let start = 0; start < size && regions.length < options.maxCandidates; start++) {
		if (!bitmap[start] || label[start]) continue;
		const id = regions.length + 1;
		let x0 = width;
		let y0 = height;
		let x1 = -1;
		let y1 = -1;
		let top = 0;
		stack[top++] = start;
		label[start] = id;
		while (top) {
			const i = stack[--top];
			const x = i % width;
			const y = (i - x) / width;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
			for (let dy = -1; dy <= 1; dy++) {
				const ny = y + dy;
				if (ny < 0 || ny >= height) continue;
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					if (nx < 0 || nx >= width) continue;
					const n = ny * width + nx;
					if (bitmap[n] && !label[n]) {
						label[n] = id;
						stack[top++] = n;
					}
				}
			}
		}
		regions.push([x0, y0, x1, y1]);
	}

	const boxes: DetectedBox[] = [];
	for (const [x0, y0, x1, y1] of regions) {
		// minAreaRect over contour points: extents are measured between pixel centres.
		const w = x1 - x0;
		const h = y1 - y0;
		if (Math.min(w, h) < MIN_SIZE) continue;
		// box_score_fast: mean probability inside the (here axis-aligned) box.
		let sum = 0;
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) sum += probabilities[y * width + x];
		const score = sum / ((w + 1) * (h + 1));
		if (options.boxThresh > score) continue;
		// unclip: offset the polygon by area * ratio / perimeter, as pyclipper JT_ROUND does
		// along straight edges, then take its bounding rectangle again.
		const distance = (w * h * options.unclipRatio) / (2 * (w + h));
		const left = clipperRound(x0 - distance);
		const right = clipperRound(x1 + distance);
		const upper = clipperRound(y0 - distance);
		const lower = clipperRound(y1 + distance);
		if (Math.min(right - left, lower - upper) < MIN_SIZE + 2) continue;
		// Map to the destination image like np.round(box / width * dest_width) in float32.
		const scaleX = (value: number) =>
			Math.min(
				Math.max(roundHalfEven(Math.fround(Math.fround(value / width) * destWidth)), 0),
				destWidth,
			);
		const scaleY = (value: number) =>
			Math.min(
				Math.max(roundHalfEven(Math.fround(Math.fround(value / height) * destHeight)), 0),
				destHeight,
			);
		// filter_det_res: clip to the last pixel and drop slivers of 3 px or less.
		const box: Box = [
			Math.min(scaleX(left), destWidth - 1),
			Math.min(scaleY(upper), destHeight - 1),
			Math.min(scaleX(right), destWidth - 1),
			Math.min(scaleY(lower), destHeight - 1),
		];
		if (box[2] - box[0] <= 3 || box[3] - box[1] <= 3) continue;
		boxes.push({ box, score });
	}
	return boxes;
}

/** TextDetector.sorted_boxes: rows by top edge (10 px tolerance), then left to right. */
export function sortBoxes<T extends { box: Box }>(items: T[]): T[] {
	const byTop = items
		.map((item, index) => ({ item, index }))
		.sort((a, b) => a.item.box[1] - b.item.box[1] || a.index - b.index);
	let line = 0;
	const lines = byTop.map((entry, i) => {
		if (i > 0 && entry.item.box[1] - byTop[i - 1].item.box[1] >= SORT_Y_THRESHOLD) line++;
		return { ...entry, line, order: i };
	});
	return lines
		.sort((a, b) => a.line - b.line || a.item.box[0] - b.item.box[0] || a.order - b.order)
		.map((entry) => entry.item);
}
