import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { dialog, ipcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getAppPath: () => process.cwd(),
		getPath: () => process.env.TEMP ?? process.cwd(),
		isPackaged: false,
	},
	BrowserWindow: {
		fromWebContents: () => ({ isDestroyed: () => false }),
	},
	dialog: {
		showSaveDialog: vi.fn(),
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
	},
	powerSaveBlocker: {
		isStarted: () => true,
		start: () => 1,
		stop: vi.fn(),
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "ffmpeg",
}));

import { moveExportedTempFile, registerExportHandlers } from "./export";

const tempDirs: string[] = [];
const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const ffprobe = require("ffprobe-static").path as string;
const run = promisify(execFile);

async function makeTempDir() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-move-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
	);
});

describe("moveExportedTempFile", () => {
	it("moves an app-managed export temp file to the selected destination", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "export-temp.mp4");
		const destinationPath = path.join(dir, "export-final.mp4");
		await fs.writeFile(tempPath, "recordly-export");

		await moveExportedTempFile(tempPath, destinationPath);

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("recordly-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
	});

	it("falls back when Windows reports the destination already exists during initial rename", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "export-temp.mp4");
		const destinationPath = path.join(dir, "export-final.mp4");
		await fs.writeFile(tempPath, "new-export");
		await fs.writeFile(destinationPath, "previous-export");

		const originalRename = fs.rename.bind(fs);
		const renameSpy = vi.spyOn(fs, "rename");
		renameSpy.mockImplementation(async (from, to) => {
			if (from === tempPath && to === destinationPath) {
				const error = new Error("destination exists") as NodeJS.ErrnoException;
				error.code = "EEXIST";
				throw error;
			}

			return originalRename(from, to);
		});

		await moveExportedTempFile(tempPath, destinationPath);

		await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("new-export");
		await expect(fs.access(tempPath)).rejects.toThrow();
	});

	it("preserves both complete files when a cross-volume copy fails partway", async () => {
		const dir = await makeTempDir();
		const tempPath = path.join(dir, "complete-temp.mp4");
		const destinationPath = path.join(dir, "previous.mp4");
		await fs.writeFile(tempPath, "new-complete-export");
		await fs.writeFile(destinationPath, "previous-complete-export");
		vi.spyOn(fs, "rename").mockRejectedValue(
			Object.assign(new Error("cross volume"), { code: "EXDEV" }),
		);
		vi.spyOn(fs, "copyFile").mockImplementation(async (_from, to) => {
			await fs.writeFile(to, "partial-copy");
			throw Object.assign(new Error("ENOSPC: copy failed"), { code: "ENOSPC" });
		});
		await expect(moveExportedTempFile(tempPath, destinationPath)).rejects.toThrow("ENOSPC");
		expect(await fs.readFile(tempPath, "utf8")).toBe("new-complete-export");
		expect(await fs.readFile(destinationPath, "utf8")).toBe("previous-complete-export");
		expect((await fs.readdir(dir)).sort()).toEqual(["complete-temp.mp4", "previous.mp4"]);
	});
});

describe("completed export destination safety", () => {
	it.each([
		"save-exported-video",
		"write-exported-video-to-path",
	])("preserves an existing export when %s fails after a partial write", async (channel) => {
		const dir = await makeTempDir();
		const destinationPath = path.join(dir, "previous.mp4");
		await fs.writeFile(destinationPath, "previous-complete-export");
		vi.mocked(dialog.showSaveDialog).mockResolvedValue({
			canceled: false,
			filePath: destinationPath,
		});
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
		const originalWrite = fs.writeFile.bind(fs);
		vi.spyOn(fs, "writeFile").mockImplementation(async (file) => {
			await originalWrite(file, "truncated");
			throw Object.assign(new Error("ENOSPC: disk full while writing"), { code: "ENOSPC" });
		});

		const result = await handler(
			{ sender: {} } as never,
			new TextEncoder().encode("new-complete-export").buffer,
			channel === "save-exported-video" ? "export.mp4" : destinationPath,
		);

		expect(result.success).toBe(false);
		expect(await fs.readFile(destinationPath, "utf8")).toBe("previous-complete-export");
		expect(result.message).toContain("ENOSPC");
		expect(await fs.readdir(dir)).toEqual(["previous.mp4"]);
	});

	it("saves a real audiovisual MP4 with captions, retains its source, and decodes the completed file", async () => {
		const dir = await makeTempDir();
		const sourcePath = path.join(dir, "source.mp4");
		const destinationPath = path.join(dir, "nested", "saved.mp4");
		await run(ffmpeg, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=160x90:r=10:d=0.4",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=0.4",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-threads",
			"1",
			"-y",
			sourcePath,
		]);
		const original = await fs.readFile(sourcePath);
		await fs.mkdir(path.dirname(destinationPath));
		await fs.writeFile(destinationPath, "old-complete-file");
		// A filesystem may support real writes while not implementing statfs.
		vi.spyOn(fs, "statfs").mockRejectedValue(
			Object.assign(new Error("unsupported filesystem query"), { code: "ENOSYS" }),
		);
		vi.mocked(ipcMain.handle).mockClear();
		registerExportHandlers();
		const handler = vi
			.mocked(ipcMain.handle)
			.mock.calls.find(([name]) => name === "write-exported-video-to-path")![1];
		const result = await handler(
			{ sender: {} } as never,
			Uint8Array.from(original).buffer,
			destinationPath,
			{
				format: "both",
				cues: [{ startMs: 0, endMs: 300, text: "保存测试" }],
			},
		);
		expect(result.success).toBe(true);
		expect(await fs.readFile(sourcePath)).toEqual(original);
		expect(await fs.readFile(destinationPath)).toEqual(original);
		const { stdout } = await run(ffprobe, [
			"-v",
			"error",
			"-show_streams",
			"-show_format",
			"-of",
			"json",
			destinationPath,
		]);
		const probe = JSON.parse(stdout);
		expect(
			probe.streams.map((stream: { codec_type: string }) => stream.codec_type).sort(),
		).toEqual(["audio", "video"]);
		expect(Number(probe.format.duration)).toBeCloseTo(0.4, 1);
		await run(ffmpeg, ["-v", "error", "-xerror", "-i", destinationPath, "-f", "null", "-"]);
		expect(await fs.readFile(path.join(dir, "nested", "saved.srt"), "utf8")).toContain(
			"保存测试",
		);
		expect(await fs.readFile(path.join(dir, "nested", "saved.vtt"), "utf8")).toContain(
			"00:00:00.000 --> 00:00:00.300",
		);
		expect((await fs.readdir(path.dirname(destinationPath))).sort()).toEqual([
			"saved.mp4",
			"saved.srt",
			"saved.vtt",
		]);
	});
});
