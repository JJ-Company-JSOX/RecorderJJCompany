// The narration pass with the real bundled OCR engine, opened the way the voice-over handler
// opens it, when the build machine has prepared the PP-OCRv6 models (npm run
// prepare:offline-ocr) and built the worker (vite build); skipped otherwise. The recording is
// the OCR fixture screenshot: first without its export dialog, then a click on "文件" and
// the dialog appears.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }));
import { describeNarrationFrames, type LookFn } from "./narrationFrames";
import { openBundledOcr } from "./ocr/bundledOcr";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string;
const ffprobePath = require("ffprobe-static").path as string;
const root = fileURLToPath(new URL("../../../vendor/offline-ai/win32-x64/ocr", import.meta.url));
const workerPath = fileURLToPath(new URL("../../../dist-electron/ocr-worker.cjs", import.meta.url));
const ready =
	existsSync(path.join(root, "manifest.json")) &&
	existsSync(workerPath) &&
	existsSync(ffmpegPath);

const dir = mkdtempSync(path.join(tmpdir(), "recordly-narration-ocr-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** 768x432 RGB24: a menu bar, an export dialog and a status bar. */
function screenshot() {
	const ppm = gunzipSync(
		readFileSync(
			fileURLToPath(new URL("./ocr/fixtures/ui-screenshot.ppm.gz", import.meta.url)),
		),
	);
	const header = /^P6\n(\d+) (\d+)\n255\n/.exec(ppm.subarray(0, 32).toString("latin1"));
	if (!header || header[1] !== "768" || header[2] !== "432") throw new Error("Bad PPM fixture");
	return Buffer.from(ppm.subarray(header[0].length));
}

/** 2.1 s of the page without the dialog, then 2.4 s with it; the click is at 2 s. */
function recording() {
	const after = screenshot();
	const before = Buffer.from(after);
	// Rows 40-403 hold the dialog; the page behind it is a flat (246, 246, 248).
	for (let i = 40 * 768 * 3; i < 404 * 768 * 3; i += 3) before.set([246, 246, 248], i);
	const fps = 30;
	const frames = [
		...Array.from({ length: 63 }, () => before),
		...Array.from({ length: 72 }, () => after),
	];
	const file = path.join(dir, "export-dialog.mp4");
	execFileSync(
		ffmpegPath,
		[
			"-y",
			"-loglevel",
			"error",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-s",
			"768x432",
			"-r",
			String(fps),
			"-i",
			"pipe:0",
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"12",
			"-pix_fmt",
			"yuv420p",
			file,
		],
		{ input: Buffer.concat(frames) },
	);
	return file;
}

describe.skipIf(!ready)("narration frames with the real bundled OCR", () => {
	it("gives the model the clicked label and the new dialog text as its only choices", async () => {
		const signal = new AbortController().signal;
		const ocr = await openBundledOcr(signal, { root, workerPath });
		expect(ocr).toBeDefined();
		// Like a well-behaved model: the nearest clicked option and the first result option.
		const look = vi.fn<LookFn>(async (_images, _instruction, _question, schema) => {
			const properties = (schema as { properties: Record<string, { enum?: string[] }> })
				.properties;
			return JSON.stringify({
				clicked: properties.clicked.enum?.[0] ?? "",
				element: "menu item",
				result: properties.result.enum?.[0] ?? "",
				confidence: "high",
			});
		});
		const log = vi.fn();
		try {
			const events = await describeNarrationFrames({
				videoPath: recording(),
				ffmpegPath,
				ffprobePath,
				frames: [
					{
						id: "click",
						timeMs: 2000,
						focus: { cx: 26 / 768, cy: 18 / 432 },
						action: true,
					},
				],
				look,
				ocr,
				signal,
				log,
			});
			expect(log).not.toHaveBeenCalled();
			expect(look).toHaveBeenCalledOnce();
			const [images, , question, schema] = look.mock.calls[0];
			expect(images).toHaveLength(2);
			const { clicked, result } = (
				schema as { properties: Record<string, { enum: string[] }> }
			).properties;
			// The menu item under the click comes first; text already on screen is no result.
			expect(clicked.enum[0]).toBe("文件");
			expect(clicked.enum).toContain("none");
			const compact = result.enum.map((text) => text.replace(/\s+/g, ""));
			expect(compact).toEqual(
				expect.arrayContaining(["导出视频", "Exportsettings", "开始导出"]),
			);
			for (const old of ["文件", "编辑", "视图", "帮助"]) expect(compact).not.toContain(old);
			expect(question).toContain(
				`CLICKED OPTIONS: ${JSON.stringify(clicked.enum.slice(0, -1))}`,
			);
			expect(question).toContain(
				`RESULT OPTIONS: ${JSON.stringify(result.enum.slice(0, -1))}`,
			);
			expect(events.get("click")).toMatchObject({
				kind: "action",
				clicked: "文件",
				result: result.enum[0],
				confidence: "high",
			});
		} finally {
			await ocr?.dispose();
		}
	}, 180_000);
});
