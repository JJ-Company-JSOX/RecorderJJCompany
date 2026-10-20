import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	appPath: "",
	createAsync: vi.fn(),
	generateAsync: vi.fn(),
	writeWave: vi.fn(),
}));
vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => mocks.appPath } }));
vi.mock("sherpa-onnx-node", () => ({
	OfflineTts: { createAsync: mocks.createAsync },
	writeWave: mocks.writeWave,
}));
import {
	getBundledTtsRoot,
	getBundledTtsStatus,
	synthesizeBundledNarration,
	verifyBundledTtsAssets,
} from "./tts";

const requiredFiles = [
	"model.onnx",
	"lexicon.txt",
	"tokens.txt",
	"speakers.txt",
	"date.fst",
	"phone.fst",
	"number.fst",
	"new_heteronym.fst",
	"MODEL-LICENSE.txt",
	"NOTICE.txt",
];

const temporary: string[] = [];
afterEach(async () => {
	for (const directory of temporary.splice(0)) {
		if (
			path.dirname(directory) !== os.tmpdir() ||
			!path.basename(directory).startsWith("jsox-tts-test-")
		)
			throw new Error("Unsafe test cleanup");
		await fs.rm(directory, { recursive: true, force: true });
	}
	vi.clearAllMocks();
});

async function fixture() {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-tts-test-"));
	temporary.push(base);
	mocks.appPath = base;
	const root = path.join(base, "vendor", "offline-ai", "win32-x64", "tts");
	await fs.mkdir(root, { recursive: true });
	const files = [];
	for (const name of requiredFiles) {
		const text = `${name}-data`;
		await fs.writeFile(path.join(root, name), text);
		files.push({
			path: name,
			bytes: Buffer.byteLength(text),
			sha256: createHash("sha256").update(text).digest("hex"),
		});
	}
	const manifest = { version: 1, modelName: "Test AISHELL-3 voice", files };
	await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	return { base, root, manifest };
}

describe("bundled narration voice assets", () => {
	it("resolves the dev vendor root from the app path", async () => {
		mocks.appPath = "/app";
		expect(getBundledTtsRoot()).toBe(
			path.join("/app", "vendor", "offline-ai", "win32-x64", "tts"),
		);
	});
	it("verifies the exact bundled voice assets and detects same-size corruption", async () => {
		const { root } = await fixture();
		expect(await verifyBundledTtsAssets(root)).toBe(await fs.realpath(root));
		const corrupted = "model.onnx-data".replace("data", "evil");
		await fs.writeFile(path.join(root, "model.onnx"), corrupted);
		await expect(verifyBundledTtsAssets(root)).rejects.toThrow("integrity check failed");
	});
	it("rejects manifest traversal and a missing asset", async () => {
		const { root, manifest } = await fixture();
		manifest.files.push({ ...manifest.files[0], path: "../outside.onnx" });
		await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await expect(verifyBundledTtsAssets(root)).rejects.toThrow(
			"Invalid bundled narration voice asset",
		);
		manifest.files.pop();
		await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await fs.rm(path.join(root, "model.onnx"));
		await expect(verifyBundledTtsAssets(root)).rejects.toThrow();
		if (process.platform === "win32" && process.arch === "x64")
			expect((await getBundledTtsStatus(path.dirname(root))).available).toBe(false);
	});
	it("stops before scanning or synthesizing when cancelled", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			verifyBundledTtsAssets("does-not-exist", controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "Hello" }],
				outputDirectory: "/tmp/out",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.createAsync).not.toHaveBeenCalled();
	});
	it("reports availability from the manifest only, with no model load", async () => {
		const { root } = await fixture();
		const status = await getBundledTtsStatus(path.dirname(root));
		if (process.platform === "win32" && process.arch === "x64") {
			expect(status.available).toBe(true);
			expect(status.voices).toEqual({ zh: true, en: false, ms: false });
		} else {
			expect(status.available).toBe(false);
			expect(status.voices).toEqual({ zh: false, en: false, ms: false });
		}
		expect(mocks.createAsync).not.toHaveBeenCalled();
	});
	it("rejects empty cues, an invalid cue id, and an out-of-range speaker", async () => {
		await expect(
			synthesizeBundledNarration({ cues: [], outputDirectory: "/tmp/out" }),
		).rejects.toThrow();
		if (process.platform !== "win32" || process.arch !== "x64") return;
		const { root } = await fixture();
		mocks.createAsync.mockResolvedValue({ generateAsync: mocks.generateAsync });
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "../escape", text: "Hello" }],
				outputDirectory: path.join(root, "out"),
			}),
		).rejects.toThrow("Invalid narration cue id");
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "Hello" }],
				outputDirectory: path.join(root, "out"),
				speakerId: 999,
			}),
		).rejects.toThrow("Invalid narration speaker");
		await expect(
			synthesizeBundledNarration({
				cues: [
					{ id: "suggestion-1", text: "这里点击按钮。" },
					{ id: "suggestion-2", text: "The presenter zooms in." },
				],
				outputDirectory: path.join(root, "out"),
			}),
		).rejects.toThrow("Mandarin Chinese only");
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "这里点击按钮。" }],
				outputDirectory: path.join(root, "out"),
				language: "en",
			}),
		).rejects.toThrow("English text only");
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "Zoom in on the button." }],
				outputDirectory: path.join(root, "out"),
				language: "ms",
			}),
		).rejects.toThrow("No bundled narration voice");
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "Zoom in on the button." }],
				outputDirectory: path.join(root, "out"),
				language: "en",
			}),
		).rejects.toThrow();
		expect(mocks.createAsync).not.toHaveBeenCalled();
	});
	it("synthesizes one verified-path WAV per cue using the pinned model files", async () => {
		if (process.platform !== "win32" || process.arch !== "x64") return;
		const { root } = await fixture();
		const canonical = await fs.realpath(root);
		mocks.createAsync.mockResolvedValue({ generateAsync: mocks.generateAsync });
		mocks.generateAsync.mockResolvedValue({
			samples: new Float32Array([0, 0.1, -0.1]),
			sampleRate: 16000,
		});
		const outputDirectory = path.join(root, "out");
		const results = await synthesizeBundledNarration({
			cues: [
				{ id: "suggestion-1", text: "这里点击按钮。" },
				{ id: "suggestion-2", text: "然后放大显示。" },
			],
			outputDirectory,
		});
		expect(mocks.createAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				model: expect.objectContaining({
					vits: expect.objectContaining({ model: path.join(canonical, "model.onnx") }),
				}),
				ruleFsts: [
					path.join(canonical, "date.fst"),
					path.join(canonical, "phone.fst"),
					path.join(canonical, "number.fst"),
					path.join(canonical, "new_heteronym.fst"),
				].join(","),
			}),
		);
		expect(mocks.generateAsync).toHaveBeenCalledTimes(2);
		expect(mocks.generateAsync).toHaveBeenCalledWith(
			expect.objectContaining({ text: "这里点击按钮。", sid: 0 }),
		);
		expect(mocks.writeWave).toHaveBeenCalledTimes(2);
		expect(results).toEqual([
			{
				id: "suggestion-1",
				audioPath: expect.stringMatching(/narration-zh-[a-z0-9]+-suggestion-1\.wav$/),
				durationMs: expect.any(Number),
			},
			{
				id: "suggestion-2",
				audioPath: expect.stringMatching(/narration-zh-[a-z0-9]+-suggestion-2\.wav$/),
				durationMs: expect.any(Number),
			},
		]);
	});
});
