// Text recognition pre/post-processing, ported from RapidOCR 3.10.0 (rapidocr/ch_ppocr_rec),
// Apache-2.0, Copyright (c) 2020 PaddlePaddle Authors and (c) 2021 RapidOCR Authors.
// Changed for Jsox: rewritten in TypeScript for onnxruntime-web; word boxes are not computed.
import type { RgbImage } from "../ocrTypes";
import { resizeBilinear, writeNormalizedBgr } from "./image";

/** RapidOCR config.yaml `Rec`: rec_img_shape [3, 48, 320], rec_batch_num 6. */
export const REC_HEIGHT = 48;
export const REC_MIN_WIDTH = 320;
export const REC_BATCH = 6;

export type RecognizedText = { text: string; score: number };

/**
 * CTCLabelDecode character table: index 0 is the CTC blank and a space is appended after the
 * model's dictionary, exactly as RapidOCR builds it from the ONNX `character` metadata.
 */
export function ctcCharacters(dictionary: string) {
	const entries = dictionary.split(/\r\n|\n|\r/);
	if (entries.length && entries[entries.length - 1] === "") entries.pop();
	return ["blank", ...entries, " "];
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

/**
 * Greedy CTC decoding of [batch, steps, classes] probabilities: take the arg-max per step, drop
 * repeats and blanks, and score the line by the mean probability of the kept steps.
 */
export function ctcDecode(
	probabilities: Float32Array,
	batch: number,
	steps: number,
	classes: number,
	characters: string[],
): RecognizedText[] {
	if (characters.length !== classes)
		throw new Error(`OCR dictionary has ${characters.length} entries; model has ${classes}.`);
	const results: RecognizedText[] = [];
	for (let b = 0; b < batch; b++) {
		let text = "";
		let sum = 0;
		let kept = 0;
		let previous = -1;
		for (let t = 0; t < steps; t++) {
			const base = (b * steps + t) * classes;
			let best = 0;
			let bestProbability = probabilities[base];
			for (let c = 1; c < classes; c++) {
				const p = probabilities[base + c];
				if (p > bestProbability) {
					bestProbability = p;
					best = c;
				}
			}
			if (best !== 0 && best !== previous) {
				text += characters[best];
				sum += round5(bestProbability);
				kept++;
			}
			previous = best;
		}
		results.push({ text, score: kept ? round5(sum / kept) : 0 });
	}
	return results;
}

/** Batches of crop indices in ascending width/height order, as TextRecognizer runs them. */
export function recognitionBatches(crops: RgbImage[], batchSize = REC_BATCH) {
	const order = crops
		.map((crop, index) => ({ index, ratio: crop.width / crop.height }))
		.sort((a, b) => a.ratio - b.ratio || a.index - b.index)
		.map((entry) => entry.index);
	const batches: number[][] = [];
	for (let i = 0; i < order.length; i += batchSize) batches.push(order.slice(i, i + batchSize));
	return batches;
}

/**
 * resize_norm_img for one batch: height 48, aspect ratio kept, right-padded with zeros (in
 * normalised space) to the widest crop's width, never narrower than 320 px.
 */
export function recognitionInput(crops: RgbImage[]) {
	let maxRatio = REC_MIN_WIDTH / REC_HEIGHT;
	for (const crop of crops) maxRatio = Math.max(maxRatio, crop.width / crop.height);
	const width = Math.trunc(REC_HEIGHT * maxRatio);
	const plane = REC_HEIGHT * width;
	const data = new Float32Array(crops.length * 3 * plane);
	crops.forEach((crop, i) => {
		const scaled = Math.ceil(REC_HEIGHT * (crop.width / crop.height));
		const resized = resizeBilinear(crop, Math.min(scaled, width), REC_HEIGHT);
		writeNormalizedBgr(resized, data, i * 3 * plane, width, plane);
	});
	return { data, batch: crops.length, width };
}
