import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
	afterCrop,
	changeRegion,
	changeScope,
	describeNarrationFrames,
	isNarrationFrame,
	MAX_NARRATION_FRAMES,
	narrationFrameFilter,
	pickNarrationFrames,
} from "./narrationFrames";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string;
const ffprobePath = require("ffprobe-static").path as string;
const dir = mkdtempSync(path.join(tmpdir(), "recordly-narration-frames-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function video(name: string, filter: string) {
	const file = path.join(dir, name);
	execFileSync(ffmpegPath, [
		"-y",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		filter,
		"-pix_fmt",
		"yuv420p",
		file,
	]);
	return file;
}
const size = (jpeg: Buffer) => {
	const file = path.join(dir, `probe-${jpeg.length}.jpg`);
	require("node:fs").writeFileSync(file, jpeg);
	return execFileSync(ffprobePath, [
		"-v",
		"error",
		"-show_entries",
		"stream=width,height",
		"-of",
		"csv=p=0",
		file,
	])
		.toString()
		.trim();
};

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
	it("crops around the focus without leaving the picture", () => {
		expect(narrationFrameFilter()).not.toContain("crop");
		expect(narrationFrameFilter({ cx: 1, cy: 0 })).toContain(
			"crop=iw/2:ih/2:min(max(iw*1.0000-iw/4",
		);
	});
	it("finds where the screen changed and how much", () => {
		const blank = new Uint8Array(96 * 54).fill(200);
		expect(changeScope(changeRegion(blank, blank))).toBe("none");
		const dialog = blank.slice();
		for (let y = 20; y < 34; y++) for (let x = 60; x < 80; x++) dialog[y * 96 + x] = 40;
		const region = changeRegion(blank, dialog);
		expect(changeScope(region)).toBe("small");
		expect(region.box!.x).toBeCloseTo(59 / 96, 2);
		expect(region.box!.w).toBeCloseTo(22 / 96, 2);
		expect(changeScope(changeRegion(blank, new Uint8Array(96 * 54).fill(20)))).toBe("page");
		const crop = afterCrop(region, { cx: 0.5, cy: 0.5 });
		expect(crop.x + crop.size).toBeLessThanOrEqual(1);
		expect(crop.size).toBeGreaterThanOrEqual(1 / 3);
	});
	it("compares the frames before and after a real click, and reads other moments as screens", async () => {
		// A blue panel opens at 2 s, as if the click at (0.7, 0.6) opened a dialog.
		const file = video(
			"click.mp4",
			"color=c=white:s=1280x720:r=10:d=4,drawbox=x=800:y=380:w=300:h=200:color=blue:t=fill:enable='gte(t,2)'",
		);
		const images: Buffer[] = [];
		const look = vi.fn(async (image: Buffer, _instruction: string, question: string) => {
			images.push(image);
			return question.startsWith("LEFT")
				? JSON.stringify({
						clicked: "Open",
						element: "button",
						result: "Settings",
						confidence: "high",
					})
				: JSON.stringify({ screen: "A blank white page" });
		});
		const progress = vi.fn();
		const events = await describeNarrationFrames({
			videoPath: file,
			ffmpegPath,
			frames: [
				{ id: "click-1", timeMs: 2000, focus: { cx: 0.7, cy: 0.6 }, action: true },
				{ id: "moment-1", timeMs: 500 },
				{ id: "moment-2", timeMs: 60_000 },
			],
			look,
			signal: new AbortController().signal,
			onProgress: progress,
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
		// Past the end of the video: no frame, no event, no failure.
		expect(events.has("moment-2")).toBe(false);
		expect(images.every((image) => image[0] === 0xff && image[1] === 0xd8)).toBe(true);
		const composite = look.mock.calls.findIndex(([, , question]) =>
			question.startsWith("LEFT"),
		);
		// Before and after side by side, 448x252 each.
		expect(size(images[composite])).toBe("896,252");
		expect(progress).toHaveBeenLastCalledWith(3, 3);
	}, 30_000);
	it("keeps going when one moment's reply is unreadable", async () => {
		const file = video("plain.mp4", "testsrc2=s=640x360:r=10:duration=3");
		const look = vi
			.fn()
			.mockResolvedValueOnce("not json")
			.mockResolvedValueOnce(JSON.stringify({ screen: "Test pattern" }));
		const events = await describeNarrationFrames({
			videoPath: file,
			ffmpegPath,
			frames: [
				{ id: "a", timeMs: 500 },
				{ id: "b", timeMs: 1500 },
			],
			look,
			signal: new AbortController().signal,
		});
		expect([...events.keys()]).toEqual(["b"]);
	});
});
