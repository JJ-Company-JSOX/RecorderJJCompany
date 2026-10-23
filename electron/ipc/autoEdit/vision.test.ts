import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { analyzeVideoFrames, sampleTimes } from "./vision";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string,
	ffprobePath = require("ffprobe-static").path as string;
const dir = mkdtempSync(path.join(tmpdir(), "jsox-vision-")),
	videoPath = path.join(dir, "fixture.mkv");
const staticVideoPath = path.join(dir, "static.mkv");
const largeVideoPath = path.join(dir, "large.mkv");
const requests: {
	route: string;
	body: Record<string, unknown> & { messages: { images: string[] }[] };
}[] = [];
let remote = false,
	vision = true,
	/** How many of the next chat replies are not JSON. */
	malformed = 0,
	/** Chat requests are dropped, as when the model process has crashed. */
	chatDown = false;
let onChat: (() => void) | undefined;
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
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
			if (chatDown) {
				req.socket.destroy();
				return;
			}
			const broken = malformed > 0;
			if (broken) malformed -= 1;
			res.end(
				JSON.stringify({
					message: {
						content: broken
							? "broken JSON"
							: JSON.stringify({ focus: { x: 600, y: 400 }, caption: "Save" }),
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
	execFileSync(ffmpegPath, [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=320x180:r=10:duration=4",
		"-threads",
		"2",
		"-c:v",
		"ffv1",
		staticVideoPath,
	]);
	execFileSync(ffmpegPath, [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		"testsrc2=s=1920x1080:r=5:duration=2",
		"-threads",
		"2",
		"-c:v",
		"ffv1",
		largeVideoPath,
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
it("real FFmpeg extraction sends bounded lossless PNG samples over loopback and returns source timestamps, NOT real AI inference", async () => {
	const progress: number[] = [];
	const result = await analyzeVideoFrames({
		...options(),
		onProgress: (done) => progress.push(done),
	});
	expect(result.sampledTimesMs).toEqual([500, 1500, 2500]);
	expect(progress).toEqual([1, 2, 3]);
	// The model answers on a 0-1000 grid; the app keeps 0..1 fractions of the frame.
	expect(result.observations[0]).toEqual({
		timeMs: 500,
		focus: { cx: 0.6, cy: 0.4 },
		caption: "Save",
	});
	expect(result.observations).toHaveLength(3);
	const chats = requests.filter((r) => r.route === "/api/chat");
	expect(chats).toHaveLength(3);
	for (const chat of chats) {
		const png = Buffer.from(chat.body.messages[1].images[0], "base64");
		expect(png.subarray(1, 4).toString()).toBe("PNG");
		// A small recording is never enlarged.
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 180]);
		expect(JSON.stringify(chat.body)).not.toContain(videoPath);
		expect(chat.body.messages[0]).toMatchObject({
			content: expect.stringContaining("0 to 1000"),
		});
	}
});
it("downscales large recordings with an area filter to at most 1024x576", async () => {
	const describe = vi.fn(async (_image: Buffer) => bundledReply);
	await analyzeVideoFrames({
		...options(),
		videoPath: largeVideoPath,
		count: 1,
		bundled: { name: "Bundled fixture", describe },
	});
	const png = describe.mock.calls[0][0];
	expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 576]);
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
it("logs malformed output per sample instead of failing the pass, and aborts before invoking a model when canceled", async () => {
	malformed = 1;
	const log = vi.fn();
	const result = await analyzeVideoFrames({ ...options(), log });
	expect(result.sampledTimesMs).toEqual([500, 1500, 2500]);
	expect(result.observations.map((observation) => observation.timeMs)).toEqual([1500, 2500]);
	expect(log).toHaveBeenCalledTimes(1);
	expect(log.mock.calls[0][0]).toBe("sample at 500 ms skipped: unreadable visual model reply");
	// Nothing usable from any sample is a failure, not "nothing worth zooming into".
	malformed = 3;
	await expect(analyzeVideoFrames({ ...options(), log })).rejects.toThrow(
		"No video sample could be analyzed (unreadable visual model reply)",
	);
	malformed = 0;
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

const bundledReply = JSON.stringify({ focus: { x: 600, y: 400 }, caption: "Save" });
it("keeps the other samples when one bundled reply is unusable", async () => {
	const describe = vi
		.fn()
		.mockResolvedValueOnce(bundledReply)
		.mockResolvedValueOnce(JSON.stringify({ focus: { x: 0.5, y: 0.5 }, caption: "Fractions" }))
		.mockResolvedValueOnce(JSON.stringify({ focus: null, caption: "Done" }));
	const log = vi.fn();
	const result = await analyzeVideoFrames({
		...options(),
		bundled: { name: "Bundled fixture", describe },
		log,
	});
	expect(result.observations.map((o) => [o.timeMs, o.caption])).toEqual([
		[500, "Save"],
		[2500, "Done"],
	]);
	expect(log.mock.calls[0][0]).toContain("integers from 0 to 1000");
});
it("fails the pass with the model's own error when the model cannot be reached, instead of skipping every sample", async () => {
	const describe = vi.fn(async () => {
		throw new Error("connect ECONNREFUSED 127.0.0.1:8080");
	});
	const log = vi.fn();
	await expect(
		analyzeVideoFrames({ ...options(), bundled: { name: "Bundled fixture", describe }, log }),
	).rejects.toThrow("connect ECONNREFUSED");
	expect(describe).toHaveBeenCalledTimes(1);
	expect(log).not.toHaveBeenCalled();
	// The same for Ollama when its model process drops the request.
	const before = requests.filter((request) => request.route === "/api/chat").length;
	chatDown = true;
	try {
		await expect(analyzeVideoFrames({ ...options(), log })).rejects.toThrow();
	} finally {
		chatDown = false;
	}
	expect(requests.filter((request) => request.route === "/api/chat")).toHaveLength(before + 1);
	expect(log).not.toHaveBeenCalled();
});
it("reuses only byte-identical static JPEG replies within one bundled job and retains every sample time", async () => {
	const describe = vi.fn(async () => bundledReply);
	const progress: number[][] = [];
	const input = {
		...options(),
		videoPath: staticVideoPath,
		count: 4,
		bundled: { name: "Bundled synthetic provider", describe },
		onProgress: (done: number, total: number, timeMs: number) =>
			progress.push([done, total, timeMs]),
	};
	const result = await analyzeVideoFrames(input);
	expect(describe).toHaveBeenCalledTimes(1);
	expect(result.sampledTimesMs).toEqual([500, 1500, 2500, 3500]);
	expect(result.observations.map((observation) => observation.timeMs)).toEqual(
		result.sampledTimesMs,
	);
	expect(progress).toEqual([
		[1, 4, 500],
		[2, 4, 1500],
		[3, 4, 2500],
		[4, 4, 3500],
	]);
	// Parse each cached raw reply afresh; no mutable observation/focus object is shared.
	result.observations[0].focus!.cx = 0.1;
	expect(result.observations[1].focus?.cx).toBe(0.6);
	await analyzeVideoFrames(input);
	expect(describe).toHaveBeenCalledTimes(2);
});

it("never combines different extracted JPEGs in a moving bundled fixture", async () => {
	const describe = vi.fn(async (_image: Buffer) => bundledReply);
	const result = await analyzeVideoFrames({
		...options(),
		bundled: { name: "Bundled fixture", describe },
	});
	expect(describe).toHaveBeenCalledTimes(3);
	expect(result.observations).toHaveLength(3);
	const images = describe.mock.calls.map(([image]) => image.toString("base64"));
	expect(new Set(images).size).toBe(3);
});

it.each([
	2, 4,
])("cancellation on bundled cache-hit sample %s rejects instead of returning observations", async (cancelAt) => {
	const controller = new AbortController();
	const describe = vi.fn(async () => bundledReply);
	const progress: number[] = [];
	await expect(
		analyzeVideoFrames({
			...options(),
			videoPath: staticVideoPath,
			count: 4,
			signal: controller.signal,
			bundled: { name: "Bundled fixture", describe },
			onProgress: (done) => {
				progress.push(done);
				if (done === cancelAt) controller.abort();
			},
		}),
	).rejects.toThrow();
	expect(describe).toHaveBeenCalledTimes(1);
	expect(progress).toEqual(Array.from({ length: cancelAt }, (_, i) => i + 1));
});

it("does not cache Ollama static samples or skip its final model-unload request", async () => {
	const before = requests.filter((request) => request.route === "/api/chat").length;
	await analyzeVideoFrames({ ...options(), videoPath: staticVideoPath, count: 4 });
	const chats = requests.filter((request) => request.route === "/api/chat").slice(before);
	expect(chats).toHaveLength(4);
	expect(chats.map((chat) => chat.body.keep_alive)).toEqual(["2m", "2m", "2m", 0]);
});
