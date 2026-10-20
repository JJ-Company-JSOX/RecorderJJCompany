import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
	describeNarrationFrames,
	isNarrationFrame,
	MAX_NARRATION_FRAMES,
	narrationFrameFilter,
	pickNarrationFrames,
} from "./narrationFrames";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string;
const dir = mkdtempSync(path.join(tmpdir(), "recordly-narration-frames-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("narration frames", () => {
	it("validates frames from the renderer", () => {
		expect(isNarrationFrame({ id: "zoom-1", timeMs: 1200, focus: { cx: 0.2, cy: 0.9 } })).toBe(
			true,
		);
		expect(isNarrationFrame({ id: "speed-1", timeMs: 0 })).toBe(true);
		expect(isNarrationFrame({ id: "x", timeMs: -1 })).toBe(false);
		expect(isNarrationFrame({ id: "x", timeMs: 5, focus: { cx: 2, cy: 0 } })).toBe(false);
		expect(isNarrationFrame({ id: "x".repeat(65), timeMs: 5 })).toBe(false);
	});
	it("spreads at most eight frames evenly across the video", () => {
		const frames = Array.from({ length: 40 }, (_, i) => ({ id: `z${i}`, timeMs: i * 1000 }));
		const picked = pickNarrationFrames(frames);
		expect(picked).toHaveLength(MAX_NARRATION_FRAMES);
		expect(picked[0].timeMs).toBeLessThan(5000);
		expect(picked.at(-1)!.timeMs).toBeGreaterThan(34000);
	});
	it("crops around the focus without leaving the picture", () => {
		expect(narrationFrameFilter()).not.toContain("crop");
		expect(narrationFrameFilter({ cx: 1, cy: 0 })).toContain(
			"crop=iw/2:ih/2:min(max(iw*1.0000-iw/4",
		);
	});
	it("reads real frames with FFmpeg and keeps only usable notes", async () => {
		const video = path.join(dir, "screen.mp4");
		execFileSync(ffmpegPath, [
			"-y",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=640x360:r=10:duration=3",
			"-pix_fmt",
			"yuv420p",
			video,
		]);
		const look = vi
			.fn()
			.mockResolvedValueOnce(JSON.stringify({ screen: "Test pattern window" }))
			.mockResolvedValueOnce("not json");
		const progress = vi.fn();
		const notes = await describeNarrationFrames({
			videoPath: video,
			ffmpegPath,
			frames: [
				{ id: "zoom-1", timeMs: 500, focus: { cx: 0.9, cy: 0.9 } },
				{ id: "speed-1", timeMs: 2000 },
			],
			look,
			signal: new AbortController().signal,
			onProgress: progress,
		});
		expect(notes).toEqual(new Map([["zoom-1", "Test pattern window"]]));
		const [image] = look.mock.calls[0];
		expect(image[0]).toBe(0xff);
		expect(image[1]).toBe(0xd8);
		expect(progress).toHaveBeenLastCalledWith(2, 2);
	});
});
