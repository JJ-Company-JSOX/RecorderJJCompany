// UI layout step added for Jsox (not in RapidOCR): the detector often joins neighbouring menu
// items or tabs ("文件   编辑   视图") into one line because only blank space separates them.
// A detected box is cut where a blank column run is wider than the text is tall, so each item
// is read as its own line. Ordinary word spaces and CJK punctuation are far narrower.
import type { RgbImage } from "../ocrTypes";
import type { Box } from "./detection";

/** Ink must differ from the background by this share of the box's strongest contrast. */
const INK_SHARE = 0.4;
const MIN_INK_DELTA = 16;
/** A piece narrower than this share of the text height (a border, a caret) is not split off. */
const MIN_PIECE_SHARE = 0.5;

const luma = (data: Uint8Array, i: number) =>
	(data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;

function median(values: number[]) {
	const sorted = values.sort((a, b) => a - b);
	return sorted[sorted.length >> 1];
}

/**
 * Splits an axis-aligned text box at blank column runs at least `gapRatio` times the ink
 * height. Returns the box unchanged when there is no clear background, no such gap, or when
 * it is not a horizontal line. Each piece reaches halfway into the gaps around it.
 */
export function splitAtGaps(image: RgbImage, box: Box, gapRatio: number): Box[] {
	const [x0, y0, x1, y1] = box;
	const width = x1 - x0;
	const height = y1 - y0;
	if (!(gapRatio > 0) || width < height * 2 || height < 6) return [box];
	const { data, width: stride } = image;
	const at = (x: number, y: number) => luma(data, (y * stride + x) * 3);

	// DB boxes are expanded around the text, so their edges show the background.
	const border: number[] = [];
	for (let x = x0; x < x1; x++) border.push(at(x, y0), at(x, y1 - 1));
	for (let y = y0 + 1; y < y1 - 1; y++) border.push(at(x0, y), at(x1 - 1, y));
	const background = median(border);
	let contrast = 0;
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++)
			contrast = Math.max(contrast, Math.abs(at(x, y) - background));
	const delta = Math.max(MIN_INK_DELTA, contrast * INK_SHARE);
	if (contrast < delta) return [box];

	const ink = new Uint8Array(width);
	let top = y1;
	let bottom = y0 - 1;
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++)
			if (Math.abs(at(x, y) - background) >= delta) {
				ink[x - x0] = 1;
				if (y < top) top = y;
				if (y > bottom) bottom = y;
			}
	const inkHeight = bottom - top + 1;
	if (inkHeight < 4) return [box];
	const minGap = Math.max(4, Math.ceil(inkHeight * gapRatio));

	// Pieces of ink separated by wide blank runs, as [first, last] ink columns.
	const pieces: Array<[number, number]> = [];
	let blank = Number.POSITIVE_INFINITY;
	for (let x = 0; x < width; x++) {
		if (!ink[x]) {
			blank++;
			continue;
		}
		if (pieces.length && blank < minGap) pieces[pieces.length - 1][1] = x;
		else pieces.push([x, x]);
		blank = 0;
	}
	// A sliver (a border line, a caret) joins its nearer neighbour instead of standing alone.
	const minPiece = inkHeight * MIN_PIECE_SHARE;
	for (let i = 0; i < pieces.length && pieces.length > 1; ) {
		const [first, last] = pieces[i];
		if (last - first + 1 >= minPiece) {
			i++;
			continue;
		}
		const left = i > 0 ? first - pieces[i - 1][1] : Number.POSITIVE_INFINITY;
		const right = i < pieces.length - 1 ? pieces[i + 1][0] - last : Number.POSITIVE_INFINITY;
		if (left <= right) {
			pieces[i - 1][1] = last;
			pieces.splice(i, 1);
		} else {
			pieces[i + 1][0] = first;
			pieces.splice(i, 1);
		}
		i = 0;
	}
	if (pieces.length < 2) return [box];
	return pieces.map(([, last], i) => {
		const start = i ? Math.floor((pieces[i - 1][1] + pieces[i][0] + 1) / 2) : 0;
		const end = i < pieces.length - 1 ? Math.floor((last + pieces[i + 1][0] + 1) / 2) : width;
		return [x0 + start, y0, x0 + end, y1];
	});
}
