import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { enhanceVoice, getRnnoiseStatus } from "./rnnoise";

const runtimeRoot = path.resolve("vendor/offline-tools/win32-x64/rnnoise");
const available =
	process.platform === "win32" &&
	(await fs
		.stat(path.join(runtimeRoot, "rnnoise-cli.exe"))
		.then(() => true)
		.catch(() => false));
const temporary: string[] = [];
afterEach(async () => {
	const base = await fs.realpath(os.tmpdir());
	for (const dir of temporary.splice(0)) {
		const canonical = await fs.realpath(dir);
		if (
			path.dirname(canonical) !== base ||
			!path.basename(canonical).startsWith("jsox-rnnoise-")
		)
			throw Error("Unexpected RNNoise test cleanup path");
		await fs.rm(canonical, { recursive: true, force: true });
	}
});
describe.skipIf(!available)("real bundled RNNoise service", () => {
	it("writes a separate WAV with the original sample count and preserves the input", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-rnnoise-test-"));
		temporary.push(dir);
		const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
		const source = path.join(dir, "original.mic.wav");
		execFileSync(
			ffmpeg,
			[
				"-nostdin",
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:sample_rate=48000",
				"-af",
				"atrim=end_sample=480137",
				"-c:a",
				"pcm_s16le",
				source,
			],
			{ windowsHide: true },
		);
		const before = createHash("sha256")
			.update(await fs.readFile(source))
			.digest("hex");
		const asset = await enhanceVoice({
			sourcePath: source,
			outputDirectory: path.join(dir, "derived"),
			ffmpegPath: ffmpeg,
			runtimeRoot,
		});
		expect(asset.samples).toBe(480137);
		expect(asset.enabled).toBe(false);
		expect(asset.audioPath).not.toBe(source);
		const decoded = path.join(dir, "decoded.s16le");
		execFileSync(
			ffmpeg,
			["-nostdin", "-v", "error", "-i", asset.audioPath, "-f", "s16le", decoded],
			{ windowsHide: true },
		);
		expect((await fs.stat(decoded)).size).toBe(480137 * 2);
		expect(
			createHash("sha256")
				.update(await fs.readFile(source))
				.digest("hex"),
		).toBe(before);
		expect(await fs.readdir(path.join(dir, "derived"))).toEqual([
			path.basename(asset.audioPath),
		]);
	}, 15000);
	it("aborts work and removes temporary derived files", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-rnnoise-cancel-"));
		temporary.push(dir);
		const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
		const source = path.join(dir, "original.mic.wav");
		execFileSync(
			ffmpeg,
			[
				"-nostdin",
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:sample_rate=48000:duration=30",
				"-c:a",
				"pcm_s16le",
				source,
			],
			{ windowsHide: true },
		);
		const controller = new AbortController();
		const promise = enhanceVoice({
			sourcePath: source,
			outputDirectory: path.join(dir, "derived"),
			ffmpegPath: ffmpeg,
			runtimeRoot,
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(), 100);
		await expect(promise).rejects.toThrow();
		expect(await fs.readdir(path.join(dir, "derived"))).toEqual([]);
	}, 15000);
	it("requires valid bundled assets and refuses unavailable runtimes", async () => {
		expect((await getRnnoiseStatus(runtimeRoot)).available).toBe(true);
		expect((await getRnnoiseStatus(path.join(runtimeRoot, "missing"))).available).toBe(false);
	});
});
