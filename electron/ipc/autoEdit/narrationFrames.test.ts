import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bundledClient } from "./bundled";
import { fitSize, graySamples, rectAround, SAMPLE_MS } from "./frameGrab";
import {
	changeRect,
	changeRegion,
	changeScope,
	clickRect,
	describeNarrationFrames,
	isNarrationFrame,
	type LookFn,
	MAX_NARRATION_FRAMES,
	pickBeforeAfter,
	pickNarrationFrames,
	pointerMask,
	screenRect,
} from "./narrationFrames";
import type { OcrEngine, OcrLine, RgbImage } from "./ocrTypes";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string;
const ffprobePath = require("ffprobe-static").path as string;
const dir = mkdtempSync(path.join(tmpdir(), "recordly-narration-frames-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const signal = () => new AbortController().signal;

/** A lavfi recording: `inputs` are lavfi sources and `graph` combines them (as [0:v], [1:v], ...). */
function video(name: string, inputs: string[], graph?: string) {
	const file = path.join(dir, name);
	execFileSync(ffmpegPath, [
		"-y",
		"-loglevel",
		"error",
		...inputs.flatMap((input) => ["-f", "lavfi", "-i", input]),
		...(graph ? ["-filter_complex", graph] : []),
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-g",
		"40",
		"-pix_fmt",
		"yuv420p",
		file,
	]);
	return file;
}
const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
/** Decodes a PNG back to RGB24 with ffmpeg, to compare it with the raw frames OCR received. */
function pngPixels(png: Buffer) {
	const file = path.join(dir, `decode-${png.length}.png`);
	writeFileSync(file, png);
	return execFileSync(ffmpegPath, [
		"-loglevel",
		"error",
		"-i",
		file,
		"-pix_fmt",
		"rgb24",
		"-f",
		"rawvideo",
		"pipe:1",
	]);
}

// A click at 2.0 s on a green "button"; a blue panel slides up from 2.3 s and rests from 3.1 s.
// An orange status line is on screen the whole time, inside the area where the panel lands.
const W = 1280,
	H = 720;
const CLICK = { cx: 400 / W, cy: 150 / H };
let slide: string;
beforeAll(() => {
	slide = video(
		"slide.mp4",
		[
			`color=c=white:s=${W}x${H}:r=20:d=5`,
			"color=c=blue:s=400x300:r=20:d=5",
			"color=c=0x00b000:s=200x60:r=20:d=5",
			"color=c=0xff8000:s=160x24:r=20:d=5",
		],
		"[0:v][2:v]overlay=x=300:y=120[a];[a][3:v]overlay=x=1000:y=310[b];[b][1:v]overlay=x=760:y='if(lt(t,2.3),H,max(360,H-(t-2.3)*450))'",
	);
});

describe("narration frames", () => {
	it("validates frames from the renderer, including long recordings", () => {
		expect(isNarrationFrame({ id: "zoom-1", timeMs: 1200, focus: { cx: 0.2, cy: 0.9 } })).toBe(
			true,
		);
		expect(
			isNarrationFrame({
				id: "click-1",
				timeMs: 1200,
				focus: { cx: 0.2, cy: 0.9 },
				action: true,
			}),
		).toBe(true);
		expect(isNarrationFrame({ id: "speed-1", timeMs: 900_000 })).toBe(true);
		expect(isNarrationFrame({ id: "x", timeMs: -1 })).toBe(false);
		expect(isNarrationFrame({ id: "x", timeMs: 5, focus: { cx: 2, cy: 0 } })).toBe(false);
		expect(isNarrationFrame({ id: "x", timeMs: 5, action: "yes" })).toBe(false);
		expect(isNarrationFrame({ id: "x".repeat(65), timeMs: 5 })).toBe(false);
	});
	it("spreads at most sixteen frames evenly across the video", () => {
		const frames = Array.from({ length: 40 }, (_, i) => ({ id: `z${i}`, timeMs: i * 1000 }));
		const picked = pickNarrationFrames(frames);
		expect(picked).toHaveLength(MAX_NARRATION_FRAMES);
		expect(MAX_NARRATION_FRAMES).toBe(16);
		expect(picked[0].timeMs).toBeLessThan(3000);
		expect(picked.at(-1)!.timeMs).toBeGreaterThan(37000);
	});
	it("crops at native resolution around the click, larger for HiDPI, never outside the frame", () => {
		const hd = { width: 1920, height: 1080 };
		expect(clickRect(hd, { cx: 0.5, cy: 0.5 })).toEqual({ x: 576, y: 324, w: 768, h: 432 });
		// At a corner the area slides inside the picture instead of shrinking.
		expect(clickRect(hd, { cx: 1, cy: 0 })).toEqual({ x: 1152, y: 0, w: 768, h: 432 });
		// 4K (usually 200% scaling) shows the same UI with twice the pixels.
		expect(clickRect({ width: 3840, height: 2160 }, { cx: 0.5, cy: 0.5 })).toMatchObject({
			w: 1536,
			h: 864,
		});
		// A small window recording is shown whole.
		expect(clickRect({ width: 640, height: 360 }, { cx: 0.9, cy: 0.9 })).toEqual({
			x: 0,
			y: 0,
			w: 640,
			h: 360,
		});
		// The changed area grows by 1.3x and keeps at least the click area's context.
		const dialog = { changedFraction: 0.1, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };
		expect(changeRect(hd, dialog, { cx: 0.1, cy: 0.1 })).toEqual({
			x: 336,
			y: 188,
			w: 1248,
			h: 702,
		});
		const tiny = { changedFraction: 0.01, box: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } };
		const rect = changeRect(hd, tiny, { cx: 0.1, cy: 0.1 });
		expect(rect).toMatchObject({ w: 768, h: 432 });
		expect(rect.x + rect.w).toBeLessThanOrEqual(1920);
		expect(rect.y + rect.h).toBeLessThanOrEqual(1080);
		expect(screenRect(hd)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
		// Images stay within the vision token budget: only shrink, keep the shape, even sizes.
		expect(fitSize({ x: 0, y: 0, w: 1920, h: 1080 }, 1280, 720)).toEqual({
			width: 1280,
			height: 720,
		});
		expect(fitSize({ x: 0, y: 0, w: 768, h: 432 }, 1024, 576)).toEqual({
			width: 768,
			height: 432,
		});
		expect(fitSize({ x: 0, y: 0, w: 1920, h: 1080 }, 1280, 960, 1280 * 720)).toEqual({
			width: 1280,
			height: 720,
		});
		const odd = rectAround({ width: 1001, height: 501 }, 999, 3, 301, 101);
		expect((odd.x % 2) + (odd.y % 2) + (odd.w % 2) + (odd.h % 2)).toBe(0);
		expect(odd.x + odd.w).toBeLessThanOrEqual(1001);
	});
	it("finds where the screen changed and how much, ignoring the pointer area", () => {
		const blank = new Uint8Array(96 * 54).fill(200);
		expect(changeScope(changeRegion(blank, blank))).toBe("none");
		const dialog = blank.slice();
		for (let y = 20; y < 34; y++) for (let x = 60; x < 80; x++) dialog[y * 96 + x] = 40;
		const region = changeRegion(blank, dialog);
		expect(changeScope(region)).toBe("small");
		expect(region.box!.x).toBeCloseTo(59 / 96, 2);
		expect(region.box!.w).toBeCloseTo(22 / 96, 2);
		expect(changeScope(changeRegion(blank, new Uint8Array(96 * 54).fill(20)))).toBe("page");
		// A pressed button under the pointer is not "the result" of the click.
		const pressed = blank.slice();
		for (let y = 9; y < 13; y++) for (let x = 19; x < 23; x++) pressed[y * 96 + x] = 40;
		expect(changeScope(changeRegion(blank, pressed))).toBe("small");
		const mask = pointerMask({ cx: 20.5 / 96, cy: 10.5 / 54 });
		expect(changeScope(changeRegion(blank, pressed, 12, mask))).toBe("none");
	});
	it("waits for the screen to settle and skips the click's own flicker", () => {
		const frame = (value: number) => new Uint8Array(96 * 54).fill(value);
		const panel = (rows: number) => {
			const f = frame(150);
			for (let y = 54 - rows; y < 54; y++) for (let x = 40; x < 70; x++) f[y * 96 + x] = 30;
			return f;
		};
		// 250 ms samples from 1000 ms; the click is at 2000 ms.
		const timeline = (pictures: Uint8Array[]) =>
			pictures.map((gray, i) => ({ timeMs: 1000 + i * SAMPLE_MS, gray }));
		const hover = frame(150);
		const opening = timeline([
			frame(200), // 1000
			frame(200), // 1250
			hover, // 1500: pointer arrives, the button lights up
			hover, // 1750: stable hover, the last stable sample before the click
			hover, // 2000: click
			hover, // 2250: nothing yet
			panel(5), // 2500: the panel starts sliding in
			panel(15), // 2750
			panel(25), // 3000
			panel(30), // 3250: final position
			panel(30), // 3500
			panel(30), // 3750
		]);
		const pick = pickBeforeAfter(opening, 2000);
		expect(pick?.before.timeMs).toBe(1750);
		expect(pick?.after.timeMs).toBe(3250);
		expect(pick?.settled).toBe(true);
		// Never settles (a video playing): the sample nearest +800 ms after the change began.
		const playing = timeline(
			Array.from({ length: 16 }, (_, i) => (i < 5 ? hover : panel(5 + i * 3))),
		);
		expect(pickBeforeAfter(playing, 2000)).toMatchObject({ settled: false });
		expect(pickBeforeAfter(playing, 2000)?.after.timeMs).toBe(2750);
		// Nothing changes: BEFORE and AFTER still bracket the click.
		const idle = timeline(Array.from({ length: 16 }, () => hover));
		expect(pickBeforeAfter(idle, 2000)).toMatchObject({
			before: { timeMs: 1750 },
			after: { timeMs: 2750 },
		});
		expect(pickBeforeAfter([], 2000)).toBeUndefined();
	});
	it("streams one bounded low-resolution pass and finds the settled frame in a real video", async () => {
		const samples = await graySamples(
			ffmpegPath,
			slide,
			{ startMs: 1050, endMs: 5000 },
			signal(),
		);
		// fps=4 over 3.95 s: about 16 samples of 96x54 bytes, never the whole video.
		expect(samples.length).toBeGreaterThanOrEqual(15);
		expect(samples.length).toBeLessThanOrEqual(17);
		expect(samples.every((s) => s.gray.length === 96 * 54)).toBe(true);
		const pick = pickBeforeAfter(samples, 2000, pointerMask(CLICK));
		expect(pick?.before.timeMs).toBeGreaterThanOrEqual(1300);
		expect(pick?.before.timeMs).toBeLessThanOrEqual(1900);
		// The panel is still moving until 3.1 s; the first settled sample comes after that.
		expect(pick?.after.timeMs).toBeGreaterThanOrEqual(3100);
		expect(pick?.after.timeMs).toBeLessThanOrEqual(3400);
		expect(pick?.settled).toBe(true);
	});
	it("sends BEFORE and AFTER as two sharp PNGs in one request and reads other moments as screens", async () => {
		const calls: Parameters<LookFn>[] = [];
		const look = vi.fn<LookFn>(async (...args) => {
			calls.push(args);
			return args[0].length === 2
				? JSON.stringify({
						clicked: "Open",
						element: "button",
						result: "Settings",
						confidence: "high",
					})
				: JSON.stringify({ screen: "A blank white page" });
		});
		const progress = vi.fn();
		const log = vi.fn();
		const events = await describeNarrationFrames({
			videoPath: slide,
			ffmpegPath,
			ffprobePath,
			frames: [
				{ id: "click-1", timeMs: 2000, focus: CLICK, action: true },
				{ id: "moment-1", timeMs: 500 },
				{ id: "moment-2", timeMs: 60_000 },
			],
			look,
			signal: signal(),
			onProgress: progress,
			log,
		});
		expect(events.get("click-1")).toEqual({
			kind: "action",
			clicked: "Open",
			element: "button",
			result: "Settings",
			confidence: "high",
			scope: "small",
		});
		expect(events.get("moment-1")).toEqual({ kind: "screen", screen: "A blank white page" });
		// Past the end of the video: no frame, no event, no failure, but a log line.
		expect(events.has("moment-2")).toBe(false);
		expect(log.mock.calls.some(([m]) => m.includes("moment-2"))).toBe(true);
		const action = calls.find(([images]) => images.length === 2)!;
		const screen = calls.find(([images]) => images.length === 1)!;
		const [images, instruction, question, schema, options] = action;
		expect(images).toHaveLength(2);
		expect(images.every((image) => image.subarray(1, 4).toString() === "PNG")).toBe(true);
		// 768x432 source pixels around the click, unscaled. The panel's changed area grown by 1.3x
		// is 434 px tall (just over the 432 px minimum), also at 1:1.
		expect(pngSize(images[0])).toEqual([768, 432]);
		expect(pngSize(images[1])).toEqual([768, 434]);
		expect(options).toEqual({
			labels: ["Image 1 (BEFORE the click):", "Image 2 (AFTER the click):"],
			maxTokens: 160,
		});
		expect(instruction).toContain("Image 1 (BEFORE)");
		// The click at (400, 150) inside the crop at (16, 0): 0-1000 of the 768x432 image.
		expect(question).toBe("Click point in image 1: (500, 347).");
		expect(schema).toMatchObject({ properties: { clicked: { type: "string" } } });
		// The AFTER image shows the panel at rest (blue at its final top edge).
		const after = pngPixels(images[1]);
		const at = (x: number, y: number) => [
			...after.subarray((y * 768 + x) * 3, (y * 768 + x) * 3 + 3),
		];
		const [b0, b1, b2] = at(384, 220);
		expect(b2).toBeGreaterThan(200);
		expect(b0 + b1).toBeLessThan(60);
		expect(screen[0]).toHaveLength(1);
		expect(pngSize(screen[0][0])).toEqual([1280, 720]);
		expect(screen[4]).toEqual({ maxTokens: 176 });
		expect(progress).toHaveBeenLastCalledWith(3, 3);
	}, 30_000);
	it("keeps going when one moment's reply is unreadable, and logs it without the reply", async () => {
		const file = video("plain.mp4", ["testsrc2=s=640x360:r=10:duration=3"]);
		const look = vi
			.fn<LookFn>()
			.mockResolvedValueOnce("not json: Secret Customer Name")
			.mockResolvedValueOnce(JSON.stringify({ screen: "Test pattern" }));
		const log = vi.fn();
		const events = await describeNarrationFrames({
			videoPath: file,
			ffmpegPath,
			ffprobePath,
			frames: [
				{ id: "a", timeMs: 500 },
				{ id: "b", timeMs: 1500 },
			],
			look,
			signal: signal(),
			log,
		});
		expect([...events.keys()]).toEqual(["b"]);
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0][0]).toContain("a at 500 ms skipped");
		expect(log.mock.calls[0][0]).not.toContain("Secret");
	});
	it("asks once for near-identical moments and reuses the answer", async () => {
		const file = video("still.mp4", ["color=c=gray:s=640x360:r=10:d=4"]);
		const look = vi.fn<LookFn>(async () => JSON.stringify({ screen: "An empty gray page" }));
		const events = await describeNarrationFrames({
			videoPath: file,
			ffmpegPath,
			ffprobePath,
			frames: [
				{ id: "a", timeMs: 500 },
				{ id: "b", timeMs: 2500 },
			],
			look,
			signal: signal(),
			log: vi.fn(),
		});
		expect(look).toHaveBeenCalledOnce();
		expect(events.get("b")).toEqual(events.get("a"));
	});
	it("stops at once when canceled", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			describeNarrationFrames({
				videoPath: slide,
				ffmpegPath,
				ffprobePath,
				frames: [{ id: "a", timeMs: 500 }],
				look: vi.fn(),
				signal: controller.signal,
			}),
		).rejects.toThrow();
	});
});

/**
 * Stands in for the OCR engine: "reads" each solid-coloured block of the test video as a line of
 * text, with its real pixel box, so candidate geometry is checked against real ffmpeg crops.
 */
function colourOcr(): OcrEngine & { images: RgbImage[] } {
	const keys: [string, [number, number, number]][] = [
		["Settings", [0, 176, 0]],
		["Ready", [255, 128, 0]],
		["General settings", [0, 0, 255]],
	];
	const images: RgbImage[] = [];
	return {
		images,
		async recognize(image) {
			images.push(image);
			const lines: OcrLine[] = [];
			for (const [text, [r, g, b]] of keys) {
				let x0 = Infinity,
					y0 = Infinity,
					x1 = -1,
					y1 = -1;
				for (let y = 0; y < image.height; y++)
					for (let x = 0; x < image.width; x++) {
						const i = (y * image.width + x) * 3;
						const d =
							Math.abs(image.data[i] - r) +
							Math.abs(image.data[i + 1] - g) +
							Math.abs(image.data[i + 2] - b);
						if (d > 60) continue;
						x0 = Math.min(x0, x);
						y0 = Math.min(y0, y);
						x1 = Math.max(x1, x);
						y1 = Math.max(y1, y);
					}
				if (x1 - x0 > 8 && y1 - y0 > 8)
					lines.push({ text, score: 0.95, box: [x0, y0, x1, y1] });
			}
			return lines;
		},
		dispose: async () => undefined,
	};
}

describe("narration frames with OCR", () => {
	const frames = [{ id: "click", timeMs: 2000, focus: CLICK, action: true }];
	const reply = (clicked: string, result: string) =>
		JSON.stringify({ clicked, element: "button", result, confidence: "high" });

	it("offers only exact OCR text near the click and new after it, from raw RGB of the same crops", async () => {
		const ocr = colourOcr();
		const look = vi.fn<LookFn>(async () => reply("Settings", "General settings"));
		const events = await describeNarrationFrames({
			videoPath: slide,
			ffmpegPath,
			ffprobePath,
			frames,
			look,
			ocr,
			signal: signal(),
			log: vi.fn(),
		});
		expect(events.get("click")).toEqual({
			kind: "action",
			clicked: "Settings",
			element: "button",
			result: "General settings",
			confidence: "high",
			scope: "small",
		});
		const [images, instruction, question, schema] = look.mock.calls[0];
		// BEFORE crop, AFTER crop, and the AFTER area before the click (to tell new text from old).
		expect(ocr.images).toHaveLength(3);
		for (const [i, image] of ocr.images.entries()) {
			const [w, h] = pngSize(images[Math.min(i, 1)]);
			expect([image.width, image.height]).toEqual([w, h]);
			expect(image.data.length).toBe(w * h * 3);
		}
		// OCR sees exactly the pixels the model sees (the AFTER PNG has no marker drawn on it).
		expect(Buffer.from(ocr.images[1].data).equals(pngPixels(images[1]))).toBe(true);
		// "Ready" was already on screen before the click, so it is not offered as the result.
		expect(schema).toMatchObject({
			properties: {
				clicked: { enum: ["Settings", "none"] },
				result: { enum: ["General settings", "none"] },
			},
		});
		expect(question).toContain('CLICKED OPTIONS: ["Settings"]');
		expect(question).toContain('RESULT OPTIONS: ["General settings"]');
		expect(instruction).toContain("Answer only with an option");
	}, 30_000);
	it("never accepts text outside the list, and keeps clearly hit OCR text when the reply is bad", async () => {
		const run = (look: LookFn, log = vi.fn()) =>
			describeNarrationFrames({
				videoPath: slide,
				ffmpegPath,
				ffprobePath,
				frames,
				look,
				ocr: colourOcr(),
				signal: signal(),
				log,
			});
		// An invented label is dropped; the line under the click (read with high confidence) is kept.
		expect((await run(async () => reply("Save As", "none"))).get("click")).toMatchObject({
			clicked: "Settings",
			result: "",
		});
		const log = vi.fn();
		expect((await run(async () => "truncated {", log)).get("click")).toEqual({
			kind: "action",
			clicked: "Settings",
			element: "unknown",
			result: "General settings",
			confidence: "medium",
			scope: "small",
		});
		expect(log.mock.calls[0][0]).toContain("kept the OCR text");
	}, 30_000);
	it("falls back to the vision model alone when OCR fails", async () => {
		const ocr: OcrEngine = {
			recognize: async () => {
				throw Error("engine crashed");
			},
			dispose: async () => undefined,
		};
		const look = vi.fn<LookFn>(async () => reply("Open", "Panel"));
		const log = vi.fn();
		const events = await describeNarrationFrames({
			videoPath: slide,
			ffmpegPath,
			ffprobePath,
			frames,
			look,
			ocr,
			signal: signal(),
			log,
		});
		expect(events.get("click")).toMatchObject({ clicked: "Open", result: "Panel" });
		expect(look.mock.calls[0][3]).toMatchObject({
			properties: { clicked: { type: "string" } },
		});
		expect(log.mock.calls[0][0]).toContain("OCR skipped for click: engine crashed");
	}, 30_000);
	it("drives a llama-server over HTTP: one multi-image request, the OCR enum schema, parsed reply", async () => {
		const bodies: Record<string, unknown>[] = [];
		const server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				bodies.push(JSON.parse(body));
				res.setHeader("Content-Type", "application/json");
				const content = reply("Settings", "General settings");
				res.end(JSON.stringify({ choices: [{ message: { content } }] }));
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const client = bundledClient((server.address() as AddressInfo).port, "token", signal());
			const events = await describeNarrationFrames({
				videoPath: slide,
				ffmpegPath,
				ffprobePath,
				frames,
				look: client.look,
				ocr: colourOcr(),
				signal: signal(),
				log: vi.fn(),
			});
			expect(events.get("click")).toMatchObject({
				clicked: "Settings",
				result: "General settings",
				scope: "small",
			});
			expect(bodies).toHaveLength(1);
			const body = bodies[0] as {
				max_tokens: number;
				response_format: { schema: { properties: Record<string, unknown> } };
				messages: {
					role: string;
					content: { type: string; text?: string; image_url?: { url: string } }[];
				}[];
			};
			expect(body.max_tokens).toBe(160);
			expect(body.response_format.schema.properties.clicked).toEqual({
				enum: ["Settings", "none"],
			});
			const parts = body.messages[1].content;
			expect(parts.map((p) => p.type)).toEqual([
				"text",
				"image_url",
				"text",
				"image_url",
				"text",
			]);
			expect(parts[0].text).toBe("Image 1 (BEFORE the click):");
			expect(parts[2].text).toBe("Image 2 (AFTER the click):");
			for (const part of [parts[1], parts[3]]) {
				expect(part.image_url?.url.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(
					true,
				);
				// Lossless crops of a 1280x720 recording stay small enough to send quickly.
				expect(part.image_url!.url.length).toBeLessThan(4_000_000);
			}
			expect(parts[4].text).toContain("Click point in image 1: (500, 347).");
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}, 30_000);
});
