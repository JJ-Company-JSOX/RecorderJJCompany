// Runs the real PP-OCRv6 models when the build machine has prepared them
// (npm run prepare:offline-ocr); skipped otherwise. The fixture is a Pillow-rendered
// 768x432 dialog in Noto Sans SC / Inter, stored as a gzip'd binary PPM.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { OcrLine, RgbImage } from "../ocrTypes";

vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }));
import { createBundledOcrEngine, getBundledOcrStatus } from "./bundledOcr";
import { createOcrRuntime } from "./runtime";

const root = fileURLToPath(new URL("../../../../vendor/offline-ai/win32-x64/ocr", import.meta.url));
const workerPath = fileURLToPath(
	new URL("../../../../dist-electron/ocr-worker.cjs", import.meta.url),
);
const modelsReady = existsSync(`${root}/manifest.json`);

// Ground truth: the text and glyph box Pillow drew.
const EXPECTED: Array<{ text: string; box: [number, number, number, number] }> = [
	{ text: "文件", box: [12, 11, 40, 25] },
	{ text: "编辑", box: [60, 11, 88, 25] },
	{ text: "视图", box: [108, 11, 136, 26] },
	{ text: "帮助", box: [156, 11, 184, 26] },
	{ text: "导出视频", box: [64, 74, 144, 94] },
	{ text: "Export settings", box: [64, 113, 163, 127] },
	{ text: "分辨率", box: [64, 154, 106, 170] },
	{ text: "1920 x 1080", box: [232, 157, 308, 167] },
	{ text: "帧率", box: [64, 202, 92, 217] },
	{ text: "60 fps", box: [232, 201, 275, 215] },
	{ text: "Output format", box: [64, 249, 157, 263] },
	{ text: "MP4 (H.264)", box: [232, 248, 317, 261] },
	{ text: "导出完成后会自动打开文件夹", box: [64, 298, 220, 312] },
	{ text: "Cancel", box: [538, 354, 584, 366] },
	{ text: "开始导出", box: [630, 356, 686, 370] },
	{ text: "已保存 14:32", box: [10, 416, 79, 428] },
];

function fixture(): RgbImage {
	const ppm = gunzipSync(
		readFileSync(fileURLToPath(new URL("./fixtures/ui-screenshot.ppm.gz", import.meta.url))),
	);
	const header = /^P6\n(\d+) (\d+)\n255\n/.exec(ppm.subarray(0, 32).toString("latin1"));
	if (!header) throw new Error("Bad PPM fixture");
	const [text, width, height] = header;
	return {
		width: Number(width),
		height: Number(height),
		data: new Uint8Array(ppm.subarray(text.length)),
	};
}

/** Spacing between CJK and Latin words is not part of the contract; characters are. */
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");

function expectUiText(lines: OcrLine[]) {
	expect(lines).toHaveLength(EXPECTED.length);
	for (const { text, box } of EXPECTED) {
		const cx = (box[0] + box[2]) / 2;
		const cy = (box[1] + box[3]) / 2;
		const line = lines.find(
			(entry) =>
				entry.box[0] <= cx &&
				cx <= entry.box[2] &&
				entry.box[1] <= cy &&
				cy <= entry.box[3],
		);
		expect(line && normalize(line.text), text).toBe(normalize(text));
		expect(line?.score).toBeGreaterThan(0.9);
	}
}

describe.skipIf(!modelsReady)("bundled OCR with the real models", () => {
	it("reads Chinese, English and digits from a UI screenshot", async () => {
		const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
		const runtime = await createOcrRuntime({
			detectionModel: `${root}/PP-OCRv6_det_small.onnx`,
			recognitionModel: `${root}/PP-OCRv6_rec_small.onnx`,
			dictionary: `${root}/keys.txt`,
			wasmModule: `${root}/runtime/ort-wasm-simd-threaded.mjs`,
			wasmBinary: `${root}/runtime/ort-wasm-simd-threaded.wasm`,
			runtimeVersion: manifest.runtimeVersion,
			threads: 2,
		});
		try {
			expectUiText(await runtime.recognize(fixture()));
		} finally {
			await runtime.release();
		}
	}, 180_000);

	it.skipIf(!existsSync(workerPath))(
		"reads the same through the built worker, with every file hash-checked",
		async () => {
			expect((await getBundledOcrStatus(root)).available).toBe(true);
			const engine = createBundledOcrEngine({ root, workerPath, threads: 2 });
			try {
				const image = fixture();
				expectUiText(await engine.recognize(image));
				// The caller's pixels are copied, not moved into the worker.
				expect(image.data.byteLength).toBe(768 * 432 * 3);
			} finally {
				await engine.dispose();
			}
		},
		180_000,
	);
});
