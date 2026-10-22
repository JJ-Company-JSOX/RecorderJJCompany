// Shared OCR contract between the narration pipeline and the bundled OCR engine.
export type RgbImage = {
	width: number;
	height: number;
	/** RGB24, row-major, width * height * 3 bytes. */
	data: Uint8Array;
};

export type OcrLine = {
	text: string;
	/** Mean character confidence, 0..1. */
	score: number;
	/** Axis-aligned box in image pixels: [x0, y0, x1, y1]. */
	box: [number, number, number, number];
};

export interface OcrEngine {
	recognize(image: RgbImage): Promise<OcrLine[]>;
	dispose(): Promise<void>;
}
