// End-to-end OCR flow, ported from RapidOCR 3.10.0 (rapidocr/main.py, utils/process_img.py),
// Apache-2.0, Copyright (c) 2021 RapidOCR Authors. Changed for Jsox: rewritten in TypeScript
// with injectable inference; the angle classifier is skipped because UI text is upright, and
// detected lines are split at wide blank gaps (gaps.ts) so separate UI items stay separate.
import type { OcrLine, RgbImage } from "../ocrTypes";
import {
	type Box,
	boxesFromProbabilityMap,
	DETECTION_DEFAULTS,
	type DetectionOptions,
	detectionInput,
	roundHalfEven,
	sortBoxes,
} from "./detection";
import { splitAtGaps } from "./gaps";
import { assertRgbImage, cropRgb, padVertical, resizeBilinear, rotate90 } from "./image";
import { ctcDecode, recognitionBatches, recognitionInput } from "./recognition";

export type OcrInference = {
	/** Runs detection on 1x3xHxW data and returns the 1x1xHxW probability map. */
	detect(data: Float32Array, width: number, height: number): Promise<Float32Array>;
	/** Runs recognition on Nx3x48xW data and returns [N, steps, classes] probabilities. */
	recognize(
		data: Float32Array,
		batch: number,
		width: number,
	): Promise<{ data: Float32Array; steps: number; classes: number }>;
};

export type OcrOptions = DetectionOptions & {
	/** Global.text_score: lines below this mean confidence are dropped. */
	textScore: number;
	minSideLen: number;
	maxSideLen: number;
	minHeight: number;
	widthHeightRatio: number;
	/** Split a line where blank space is wider than this many text heights; 0 keeps RapidOCR's lines. */
	gapSplitRatio: number;
};

/** RapidOCR config.yaml `Global` and `Det` defaults, plus the Jsox gap split. */
export const OCR_DEFAULTS: OcrOptions = {
	...DETECTION_DEFAULTS,
	textScore: 0.5,
	minSideLen: 30,
	maxSideLen: 2000,
	minHeight: 30,
	widthHeightRatio: 8,
	gapSplitRatio: 1,
};

/** resize_image_within_bounds: shrink past max_side_len, enlarge below min_side_len. */
function boundImage(image: RgbImage, options: OcrOptions) {
	let current = image;
	let ratioX = 1;
	let ratioY = 1;
	const fit = (target: number, longest: boolean) => {
		const { width: w, height: h } = current;
		const ratio = longest ? target / Math.max(w, h) : target / Math.min(w, h);
		const height = roundHalfEven(Math.trunc(h * ratio) / 32) * 32;
		const width = roundHalfEven(Math.trunc(w * ratio) / 32) * 32;
		if (width <= 0 || height <= 0) throw new Error("OCR input image is too small.");
		current = resizeBilinear(current, width, height);
		ratioX = w / width;
		ratioY = h / height;
	};
	if (Math.max(current.width, current.height) > options.maxSideLen) fit(options.maxSideLen, true);
	if (Math.min(current.width, current.height) < options.minSideLen)
		fit(options.minSideLen, false);
	return { image: current, ratioX, ratioY };
}

/** apply_vertical_padding: very flat or very short images get black rows above and below. */
function padFlatImage(image: RgbImage, options: OcrOptions) {
	const { width: w, height: h } = image;
	if (h > options.minHeight && w / h <= options.widthHeightRatio) return { image, top: 0 };
	const target = Math.max(Math.trunc(w / options.widthHeightRatio), options.minHeight) * 2;
	const top = Math.trunc(Math.abs(target - h) / 2);
	return { image: padVertical(image, top), top };
}

/** get_rotate_crop_image for an axis-aligned box: a plain copy, turned if it is tall. */
function cropBox(image: RgbImage, [x0, y0, x1, y1]: Box) {
	const crop = cropRgb(image, x0, y0, x1 - x0, y1 - y0);
	return crop.height / crop.width >= 1.5 ? rotate90(crop) : crop;
}

/** Detects and reads every text line; boxes are returned in `image` pixels, reading order. */
export async function runOcr(
	image: RgbImage,
	inference: OcrInference,
	characters: string[],
	options: OcrOptions = OCR_DEFAULTS,
): Promise<OcrLine[]> {
	assertRgbImage(image);
	const bounded = boundImage(image, options);
	const padded = padFlatImage(bounded.image, options);
	const input = detectionInput(padded.image, options);
	if (!input) return [];
	const map = await inference.detect(input.data, input.width, input.height);
	const detected = sortBoxes(
		boxesFromProbabilityMap(
			map,
			input.width,
			input.height,
			padded.image.width,
			padded.image.height,
			options,
		),
	).flatMap(({ box, score }) =>
		splitAtGaps(padded.image, box, options.gapSplitRatio).map((part) => ({ box: part, score })),
	);
	if (!detected.length) return [];

	const crops = detected.map(({ box }) => cropBox(padded.image, box));
	const texts = new Array<{ text: string; score: number }>(crops.length);
	for (const batch of recognitionBatches(crops)) {
		const prepared = recognitionInput(batch.map((index) => crops[index]));
		const output = await inference.recognize(prepared.data, prepared.batch, prepared.width);
		const decoded = ctcDecode(
			output.data,
			prepared.batch,
			output.steps,
			output.classes,
			characters,
		);
		batch.forEach((index, i) => {
			texts[index] = decoded[i];
		});
	}

	const lines: OcrLine[] = [];
	detected.forEach(({ box }, i) => {
		const { text, score } = texts[i];
		if (!text.trim() || score < options.textScore) return;
		// map_boxes_to_original: undo the padding, then the bounding resize, then clip.
		const x = (value: number) =>
			Math.min(Math.max(Math.round(value * bounded.ratioX), 0), image.width);
		const y = (value: number) =>
			Math.min(Math.max(Math.round((value - padded.top) * bounded.ratioY), 0), image.height);
		lines.push({ text, score, box: [x(box[0]), y(box[1]), x(box[2]), y(box[3])] });
	});
	return lines;
}
