import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), appPath: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => mocks.appPath } }));
vi.mock("./generate", () => ({ generateAutoCaptionsFromVideo: mocks.generate }));
import {
	generateBundledSpeechTranscript,
	getBundledSpeechStatus,
	verifyBundledSpeechAssets,
} from "./bundledSpeech";

const temporary: string[] = [];
afterEach(async () => {
	for (const directory of temporary.splice(0)) {
		if (
			path.dirname(directory) !== os.tmpdir() ||
			!path.basename(directory).startsWith("jsox-speech-test-")
		)
			throw new Error("Unsafe test cleanup");
		await fs.rm(directory, { recursive: true, force: true });
	}
	vi.clearAllMocks();
});
async function fixture() {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-speech-test-"));
	temporary.push(base);
	mocks.appPath = base;
	const root = path.join(base, "vendor/offline-ai/win32-x64/speech");
	await fs.mkdir(path.join(root, "runtime"), { recursive: true });
	const files = [];
	for (const [name, text] of [
		["ggml-small-q5_1.bin", "model-data"],
		["runtime/whisper-cli.exe", "runtime-data"],
	]) {
		await fs.writeFile(path.join(root, name), text);
		files.push({
			path: name,
			bytes: Buffer.byteLength(text),
			sha256: createHash("sha256").update(text).digest("hex"),
		});
	}
	const manifest = { version: 1, modelName: "Test multilingual speech", files };
	await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	return { base, root, manifest };
}

describe("bundled speech assets", () => {
	it("verifies the exact bundled runtime/model and detects same-size corruption", async () => {
		const { root } = await fixture();
		expect((await verifyBundledSpeechAssets(root)).modelPath).toBe(
			path.join(await fs.realpath(root), "ggml-small-q5_1.bin"),
		);
		await fs.writeFile(path.join(root, "ggml-small-q5_1.bin"), "bad!!-data");
		await expect(verifyBundledSpeechAssets(root)).rejects.toThrow("integrity check failed");
	});
	it("rejects manifest traversal and a missing runtime", async () => {
		const { root, manifest } = await fixture();
		manifest.files.push({ ...manifest.files[0], path: "../outside.bin" });
		await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await expect(verifyBundledSpeechAssets(root)).rejects.toThrow(
			"Invalid bundled speech asset",
		);
		manifest.files.pop();
		await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await fs.rm(path.join(root, "runtime/whisper-cli.exe"));
		await expect(verifyBundledSpeechAssets(root)).rejects.toThrow();
		if (process.platform === "win32" && process.arch === "x64")
			expect((await getBundledSpeechStatus(root)).available).toBe(false);
	});
	it("rejects canonical runtime paths outside the bundle through a junction", async () => {
		const { root, base } = await fixture();
		const outside = path.join(base, "outside");
		await fs.rename(path.join(root, "runtime"), outside);
		await fs.symlink(
			outside,
			path.join(root, "runtime"),
			process.platform === "win32" ? "junction" : "dir",
		);
		await expect(verifyBundledSpeechAssets(root)).rejects.toThrow("missing or corrupt");
	});
	it("stops before scanning or launching when cancelled", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			verifyBundledSpeechAssets("does-not-exist", controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		await expect(
			generateBundledSpeechTranscript({
				videoPath: "/approved/video.mp4",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.generate).not.toHaveBeenCalled();
	});
	it("passes only supplied approved candidates with the verified runtime and model", async () => {
		if (process.platform !== "win32" || process.arch !== "x64") return;
		const { root } = await fixture();
		const candidates = [{ path: "/approved/mic.wav", label: "microphone audio sidecar" }];
		mocks.generate.mockResolvedValue({
			cues: [],
			audioSourceLabel: "microphone audio sidecar",
		});
		await generateBundledSpeechTranscript({
			videoPath: "/approved/video.mp4",
			candidates,
			language: "zh",
		});
		expect(mocks.generate).toHaveBeenCalledWith(
			expect.objectContaining({
				candidates,
				language: "zh",
				whisperModelPath: path.join(await fs.realpath(root), "ggml-small-q5_1.bin"),
				whisperExecutablePath: path.join(
					await fs.realpath(root),
					"runtime/whisper-cli.exe",
				),
			}),
		);
	});
});
