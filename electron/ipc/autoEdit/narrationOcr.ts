import type { OcrLine } from "./ocrTypes";

/** Lines read with less confidence, or smaller than this many pixels, are noise for narration. */
const MIN_SCORE = 0.5;
const MIN_RESULT_SCORE = 0.6;
const MIN_HEIGHT = 6;
const MAX_TEXT = 60;
/** Short lists keep the schema enum (and so sampling) fast. */
const MAX_CLICKED = 6;
const MAX_RESULT = 8;
/** How far (output pixels) a line may be from the click and still be taken without the model. */
const NEAR_CLICK = 24;
/** The choice that means "no listed text fits". Never offered as a candidate itself. */
export const NONE = "none";

export type OcrCandidates = {
	/** Lines near the click, nearest first; the first contains the click point when any does. */
	clicked: string[];
	/** Lines that appear in AFTER but not in BEFORE, most prominent first. */
	result: string[];
	/** The line under (or right next to) the click, used when the model's reply is unusable. */
	underClick?: { text: string; contains: boolean; score: number };
};

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
/** Case-, width-, punctuation- and whitespace-insensitive form used to compare OCR lines. */
export const comparable = (text: string) =>
	clean(
		text
			.normalize("NFKC")
			.toLowerCase()
			.replace(/[\p{P}\p{S}]+/gu, " "),
	);

function usable(line: OcrLine, minScore: number, minChars: number) {
	const [x0, y0, x1, y1] = line.box;
	const text = clean(line.text);
	return (
		[...text].length >= minChars &&
		text.length <= MAX_TEXT &&
		Number.isFinite(line.score) &&
		line.score >= minScore &&
		x1 > x0 &&
		y1 - y0 >= MIN_HEIGHT &&
		comparable(text) !== NONE
	);
}

const distance = (box: OcrLine["box"], x: number, y: number) =>
	Math.hypot(Math.max(box[0] - x, 0, x - box[2]), Math.max(box[1] - y, 0, y - box[3]));
const area = (box: OcrLine["box"]) => (box[2] - box[0]) * (box[3] - box[1]);

function unique(lines: OcrLine[], max: number) {
	const seen = new Set<string>();
	const texts: string[] = [];
	for (const line of lines) {
		const key = comparable(line.text);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		texts.push(clean(line.text));
		if (texts.length === max) break;
	}
	return texts;
}

/**
 * Exact on-screen strings for one click. `point` is the click in BEFORE image pixels; `earlier`
 * holds every line read before the click (the click crop and, when it differs, the AFTER area
 * as it looked before), so only genuinely new text counts as the result.
 */
export function ocrCandidates(
	before: OcrLine[],
	after: OcrLine[],
	earlier: OcrLine[],
	point: { x: number; y: number },
): OcrCandidates {
	const near = before
		.filter((line) => usable(line, MIN_SCORE, 1))
		.map((line) => ({ line, d: distance(line.box, point.x, point.y) }))
		.sort((a, b) => a.d - b.d || area(a.line.box) - area(b.line.box));
	const seen = new Set(earlier.map((line) => comparable(line.text)));
	const fresh = after
		.filter((line) => usable(line, MIN_RESULT_SCORE, 2) && !seen.has(comparable(line.text)))
		.sort(
			(a, b) =>
				b.box[3] - b.box[1] - (a.box[3] - a.box[1]) ||
				a.box[1] - b.box[1] ||
				a.box[0] - b.box[0],
		);
	const first = near[0];
	return {
		clicked: unique(
			near.map((n) => n.line),
			MAX_CLICKED,
		),
		result: unique(fresh, MAX_RESULT),
		...(first && first.d <= NEAR_CLICK
			? {
					underClick: {
						text: clean(first.line.text),
						contains: first.d === 0,
						score: first.line.score,
					},
				}
			: {}),
	};
}
