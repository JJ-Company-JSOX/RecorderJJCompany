import http from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, afterAll, it, expect } from "vitest";
import { analyzeVideoFrames, sampleTimes } from "./vision";
const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string,
	ffprobePath = require("ffprobe-static").path as string;
const dir = mkdtempSync(path.join(tmpdir(), "jsox-vision-")),
	videoPath = path.join(dir, "fixture.mkv");
const requests: { route: string; body: Record<string, any> }[] = [];
let remote = false,
	vision = true,
	malformed = false;
let onChat: (() => void) | undefined;
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => (body += chunk));
	req.on("end", () => {
		const input = body ? JSON.parse(body) : {};
		requests.push({ route: req.url!, body: input });
		res.setHeader("Content-Type", "application/json");
		if (req.url === "/api/tags")
			res.end(
				JSON.stringify({
					models: [
						{
							name: "fixture:latest",
							size: 123456,
							...(remote ? { remote_host: "https://remote.invalid" } : {}),
						},
					],
				}),
			);
		else if (req.url === "/api/show")
			res.end(
				JSON.stringify({
					license: "TEST FIXTURE — not model weights",
					model_info: { fixture: true },
					capabilities: vision ? ["vision", "completion"] : ["completion"],
				}),
			);
		else {
			onChat?.();
			res.end(
				JSON.stringify({
					message: {
						content: malformed
							? "broken JSON"
							: JSON.stringify({
									focus: { cx: 0.6, cy: 0.4 },
									caption: "Save",
									rationale: "fixture observation",
								}),
					},
				}),
			);
		}
	});
});
beforeAll(async () => {
	execFileSync(ffmpegPath, [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		"testsrc2=s=320x180:r=10:duration=3",
		"-threads",
		"2",
		"-c:v",
		"ffv1",
		videoPath,
	]);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(11434, "127.0.0.1", resolve);
	});
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	rmSync(dir, { recursive: true, force: true });
});
const options = () => ({
	videoPath,
	ffmpegPath,
	ffprobePath,
	model: "fixture",
	count: 3,
	signal: new AbortController().signal,
});
it("real FFmpeg extraction sends bounded JPEG samples over loopback and returns source timestamps, NOT real AI inference", async () => {
	const progress: number[] = [];
	const result = await analyzeVideoFrames({
		...options(),
		onProgress: (done) => progress.push(done),
	});
	expect(result.sampledTimesMs).toEqual([500, 1500, 2500]);
	expect(progress).toEqual([1, 2, 3]);
	expect(result.observations).toHaveLength(3);
	const chats = requests.filter((r) => r.route === "/api/chat");
	expect(chats).toHaveLength(3);
	for (const chat of chats) {
		const jpeg = Buffer.from(chat.body.messages[1].images[0], "base64");
		expect([...jpeg.subarray(0, 2)]).toEqual([255, 216]);
		expect(jpeg.length).toBeLessThan(256000);
		expect(JSON.stringify(chat.body)).not.toContain(videoPath);
	}
});
it("refuses cloud-backed or non-vision models before any image is sent", async () => {
	const before = requests.filter((r) => r.route === "/api/chat").length;
	remote = true;
	await expect(analyzeVideoFrames(options())).rejects.toThrow("local weights");
	remote = false;
	vision = false;
	await expect(analyzeVideoFrames(options())).rejects.toThrow("vision support");
	vision = true;
	expect(requests.filter((r) => r.route === "/api/chat")).toHaveLength(before);
});
it("fails on malformed output and aborts before invoking a model when canceled", async () => {
	malformed = true;
	await expect(analyzeVideoFrames(options())).rejects.toThrow();
	malformed = false;
	const controller = new AbortController();
	controller.abort();
	await expect(analyzeVideoFrames({ ...options(), signal: controller.signal })).rejects.toThrow();
});
it("bounds sample count and video duration", () => {
	expect(sampleTimes(1000, 12)).toEqual([500]);
	expect(() => sampleTimes(601000)).toThrow();
	expect(() => sampleTimes(1000, 13)).toThrow();
});

it("cancellation interrupts an in-flight image request and discards partial results", async () => {
	const controller = new AbortController();
	onChat = () => controller.abort();
	try {
		await expect(
			analyzeVideoFrames({ ...options(), signal: controller.signal }),
		).rejects.toThrow();
	} finally {
		onChat = undefined;
	}
});
