import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const binary = createRequire(import.meta.url)("ffmpeg-static") as string | null;
const script = fileURLToPath(
	new URL("../../../scripts/diagnose-recording-audio.mjs", import.meta.url),
);

describe.skipIf(!binary || !existsSync(binary))(
	"read-only audio diagnostic CLI with real FFmpeg",
	() => {
		let directory: string;
		let video: string;
		let system: string;
		beforeAll(async () => {
			directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-audio-cli-"));
			video = path.join(directory, "recording-1.mp4");
			system = path.join(directory, "recording-1.system.wav");
			await run(binary!, [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=black:s=160x90:r=10:d=0.3",
				"-c:v",
				"libx264",
				"-threads",
				"1",
				"-pix_fmt",
				"yuv420p",
				video,
			]);
			await run(binary!, [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:duration=0.3",
				system,
			]);
		}, 20000);
		afterAll(async () => {
			if (directory) await fs.rm(directory, { force: true, recursive: true });
		});
		const inspect = async (args: string[], env = process.env) => {
			const { stdout } = await run(process.execPath, [script, ...args], {
				env,
				timeout: 20000,
			});
			return JSON.parse(stdout.slice(0, stdout.indexOf("\n}") + 2));
		};
		it("finds signal in a companion even when the MP4 itself has no audio; preserves source bytes", async () => {
			const before = await fs.readFile(system);
			const report = await inspect([video]);
			expect(report.results).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: "embedded", status: "no-audio-stream" }),
					expect.objectContaining({ kind: "system", status: "signal-detected" }),
				]),
			);
			expect(await fs.readFile(system)).toEqual(before);
		});
		it("reports quiet audio separately from missing audio", async () => {
			const quietVideo = path.join(directory, "recording-2.mp4");
			await fs.copyFile(video, quietVideo);
			await run(binary!, [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"anullsrc=r=48000:cl=mono:d=0.3",
				path.join(directory, "recording-2.system.wav"),
			]);
			expect((await inspect([quietVideo])).results).toContainEqual(
				expect.objectContaining({ kind: "system", status: "quiet-sample" }),
			);
		});
		it("honors the configured recording folder without searching unrelated directories", async () => {
			const appdata = path.join(directory, "appdata");
			const userData = path.join(appdata, "Recordly-dev");
			await fs.mkdir(userData, { recursive: true });
			const settings = path.join(userData, "recordings-settings.json");
			await fs.writeFile(settings, JSON.stringify({ recordingsDir: directory }));
			const before = await fs.readFile(settings);
			const report = await inspect([], { ...process.env, APPDATA: appdata });
			expect(path.dirname(report.videoPath)).toBe(directory);
			expect(await fs.readFile(settings)).toEqual(before);
		});
	},
);
