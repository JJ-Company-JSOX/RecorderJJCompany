import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildEditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import { analyzeLocalMedia, parseDetectedRanges } from "./media";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string;
const ffprobePath = require("ffprobe-static").path as string;
const dir = mkdtempSync(path.join(tmpdir(), "recordly-auto-edit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function fixture(name: string, video: string, audios: string[] = []) {
	const file = path.join(dir, `${name}.mkv`);
	const args = [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		`${video}:duration=8`,
	];
	for (const audio of audios) args.push("-f", "lavfi", "-i", audio);
	args.push("-map", "0:v");
	audios.forEach((_, i) => args.push("-map", `${i + 1}:a`));
	args.push("-c:v", "ffv1", "-c:a", "pcm_s16le", "-threads", "2", file);
	execFileSync(ffmpegPath, args);
	return file;
}
const staticVideo = "color=c=red:s=160x90:r=10";
const silence = "anullsrc=r=16000:cl=mono:d=8";
const tone = "sine=frequency=440:sample_rate=16000:duration=8";
const analyze = (videoPath: string, companions?: { path: string; delayMs: number }[]) =>
	analyzeLocalMedia({ videoPath, ffmpegPath, ffprobePath, companions });

describe("actual FFmpeg local analysis (synthetic fixtures, NOT language accuracy)", () => {
	it("finds a silent static interval and produces an evidence-based cut", async () => {
		const file = fixture("pause", staticVideo, [
			"aevalsrc=if(between(t\\,2\\,6)\\,0\\,0.2*sin(2*PI*440*t)):s=16000:d=8",
		]);
		const evidence = await analyze(file);
		expect(evidence.audioVerified).toBe(true);
		expect(evidence.silentRanges[0].startMs).toBeCloseTo(2000, -2);
		expect(evidence.silentRanges[0].endMs).toBeCloseTo(6000, -2);
		const plan = buildEditPlan({
			source: file,
			id: "real-filter",
			evidence,
			cursor: [],
			state: {
				clipRegions: [{ id: "clip", startMs: 0, endMs: 8000, speed: 1 }],
				zoomRegions: [],
				annotationRegions: [],
				audioRegions: [],
				autoCaptions: [],
				speedRegions: [],
			},
		});
		expect(plan.suggestions[0]).toMatchObject({ kind: "trim" });
		expect(plan.suggestions[0].startMs).toBeGreaterThanOrEqual(2390);
		expect(plan.suggestions[0].endMs).toBeLessThanOrEqual(5620);
	});
	it("treats a recording with no audio stream at all as silent", async () => {
		const result = await analyze(fixture("no-audio", staticVideo));
		expect(result.audioVerified).toBe(true);
		expect(result.noAudio).toBe(true);
		expect(result.silentRanges).toEqual([{ startMs: 0, endMs: result.durationMs }]);
	});
	it("does not cut moving silent footage", async () => {
		const result = await analyze(fixture("moving", "testsrc2=s=160x90:r=10", [silence]));
		expect(result.staticRanges).toEqual([]);
		expect(result.silentRanges.length).toBeGreaterThan(0);
	});
	it("requires silence in EVERY embedded audio track", async () => {
		const result = await analyze(fixture("two-tracks", staticVideo, [silence, tone]));
		expect(result.silentRanges).toEqual([]);
	});
	it("linked microphone audio vetoes silent embedded audio", async () => {
		const video = fixture("with-silence", staticVideo, [silence]);
		const mic = fixture("microphone", staticVideo, [tone]);
		expect((await analyze(video, [{ path: mic, delayMs: 0 }])).silentRanges).toEqual([]);
	});
	it("terminates safely on cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			analyzeLocalMedia({
				videoPath: "unused",
				ffmpegPath,
				ffprobePath,
				signal: controller.signal,
			}),
		).rejects.toThrow();
	});
});

it("parses retrospective boundaries and closes an open interval at known EOF", () => {
	expect(
		parseDetectedRanges("freeze_start: 1\nfreeze_end: 4\nfreeze_start: 7", "freeze", 8000),
	).toEqual([
		{ startMs: 1000, endMs: 4000 },
		{ startMs: 7000, endMs: 8000 },
	]);
	expect(parseDetectedRanges("silence_end: 2", "silence", 8000)).toEqual([]);
});
