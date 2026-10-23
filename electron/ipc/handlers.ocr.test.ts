// The voice-over handler as the app registers it: each narration job opens the bundled OCR
// engine (real bundledOcr module, a prepared bundle and a stand-in worker on disk), starts its
// worker only when a click is read, and disposes it when the job ends. Without the OCR bundle
// the job runs on the vision model alone, without a warning.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OcrEngine } from "./autoEdit/ocrTypes";

const fixture = vi.hoisted(() => ({
	appPath: "",
	handlers: new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>(),
	start: vi.fn(),
	close: vi.fn(),
	describe: vi.fn(),
	narrate: vi.fn(),
}));
vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getAppPath: () => fixture.appPath,
		getPath: () => fixture.appPath,
		once: vi.fn(),
	},
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => Promise<Record<string, unknown>>) =>
			fixture.handlers.set(name, handler),
		on: vi.fn(),
	},
	BrowserWindow: class {},
}));
vi.mock("./register/announcements", () => ({ registerAnnouncementHandlers: vi.fn() }));
vi.mock("./register/capturePicker", () => ({ registerCapturePickerHandlers: vi.fn() }));
vi.mock("./register/assets", () => ({ registerAssetHandlers: vi.fn() }));
vi.mock("./register/captions", () => ({ registerCaptionHandlers: vi.fn() }));
vi.mock("./register/cloudShare", () => ({ registerCloudShareHandlers: vi.fn() }));
vi.mock("./register/export", () => ({ registerExportHandlers: vi.fn() }));
vi.mock("./register/permissions", () => ({ registerPermissionHandlers: vi.fn() }));
vi.mock("./register/project", () => ({ registerProjectHandlers: vi.fn() }));
vi.mock("./register/recording", () => ({ registerRecordingHandlers: vi.fn() }));
vi.mock("./register/settings", () => ({ registerSettingsHandlers: vi.fn() }));
vi.mock("./register/sources", () => ({
	registerSourceHandlers: () => ({ pickSourceList: vi.fn() }),
}));
vi.mock("./register/offlineTools", () => ({ registerOfflineTools: vi.fn() }));
vi.mock("./export/exportStream", () => ({ cleanupAllExportStreams: vi.fn() }));
vi.mock("./export/native-video", () => ({ cleanupNativeVideoExportSessions: vi.fn() }));
vi.mock("./autoEdit/bundled", () => ({
	bundledAiStatus: vi.fn(),
	startBundledAi: fixture.start,
	stopBundledAi: vi.fn(),
}));
vi.mock("./autoEdit/narrationFrames", () => ({
	describeNarrationFrames: fixture.describe,
	isNarrationFrame: () => true,
}));
vi.mock("./autoEdit/narrator", () => ({
	generateBundledNarration: fixture.narrate,
	isNarrationLanguage: (value: unknown) => value === "en" || value === "zh",
	LocalNarrationGenerator: class {},
}));
vi.mock("./autoEdit/tts", () => ({
	getBundledTtsStatus: async () => ({ mixedLanguage: true }),
	previewBundledVoice: vi.fn(),
	synthesizeBundledNarration: vi.fn(),
}));
vi.mock("./autoEdit/media", () => ({ analyzeLocalMedia: vi.fn() }));
vi.mock("./autoEdit/vision", () => ({ analyzeVideoFrames: vi.fn() }));
vi.mock("./autoEdit/reviewer", () => ({
	inspectLocalModel: vi.fn(),
	LocalPlanReviewer: class {},
}));
vi.mock("./captions/generate", () => ({
	NoCaptionAudioError: class extends Error {},
	resolveCaptionAudioCandidates: vi.fn(),
}));
vi.mock("./captions/bundledSpeech", () => ({
	generateBundledSpeechTranscript: vi.fn(),
	getBundledSpeechStatus: vi.fn(),
}));
vi.mock("./recording/diagnostics", () => ({ getCompanionAudioStartDelayMs: async () => 0 }));
vi.mock("./ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "/ffmpeg",
	getFfprobeBinaryPath: () => "/ffprobe",
}));
vi.mock("./project/manager", () => ({ resolveApprovedLocalMediaPath: async () => "/ok.mp4" }));
vi.mock("./utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));
import { registerIpcHandlers } from "./handlers";

const FILES = {
	"PP-OCRv6_det_small.onnx": "det",
	"PP-OCRv6_rec_small.onnx": "rec",
	"keys.txt": "a\nb\n",
	"runtime/ort-wasm-simd-threaded.mjs": "export default 1;",
	"runtime/ort-wasm-simd-threaded.wasm": "wasm",
};
// Stands in for dist-electron/ocr-worker.cjs: logs each start, reads one label.
const FAKE_WORKER = `
const fs = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
fs.appendFileSync(workerData.detectionModel + ".starts", "x");
parentPort.on("message", ({ id }) =>
	parentPort.postMessage({ id, lines: [{ text: "Settings", score: 0.99, box: [4, 4, 60, 20] }] }),
);
`;

let base = "";
let ocrRoot = "";
const starts = async () =>
	(
		await fs
			.readFile(
				path.join(await fs.realpath(ocrRoot), "PP-OCRv6_det_small.onnx.starts"),
				"utf8",
			)
			.catch(() => "")
	).length;

beforeEach(async () => {
	vi.clearAllMocks();
	fixture.handlers.clear();
	base = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-ocr-wiring-"));
	fixture.appPath = base;
	ocrRoot = path.join(base, "vendor", "offline-ai", "win32-x64", "ocr");
	await fs.mkdir(path.join(ocrRoot, "runtime"), { recursive: true });
	const files = [];
	for (const [name, content] of Object.entries(FILES)) {
		await fs.writeFile(path.join(ocrRoot, name), content);
		files.push({
			path: name,
			bytes: Buffer.byteLength(content),
			sha256: createHash("sha256").update(content).digest("hex"),
		});
	}
	await fs.writeFile(
		path.join(ocrRoot, "manifest.json"),
		JSON.stringify({ version: 1, modelName: "PP-OCRv6 test", runtimeVersion: "1.30.0", files }),
	);
	await fs.mkdir(path.join(base, "dist-electron"));
	await fs.writeFile(path.join(base, "dist-electron", "ocr-worker.cjs"), FAKE_WORKER);
	fixture.start.mockResolvedValue({ close: fixture.close, complete: vi.fn(), look: vi.fn() });
	fixture.narrate.mockResolvedValue({ cues: [] });
	registerIpcHandlers(vi.fn(), vi.fn(), vi.fn(), vi.fn());
});

afterEach(async () => {
	if (path.dirname(base) !== os.tmpdir() || !path.basename(base).startsWith("jsox-ocr-wiring-"))
		throw new Error("Unsafe test cleanup");
	await fs.rm(base, { recursive: true, force: true });
});

const narrate = () =>
	fixture.handlers.get("auto-edit-narrate-bundled")!(
		{
			sender: {
				id: 7,
				isDestroyed: () => false,
				send: vi.fn(),
				once: vi.fn(),
				removeListener: vi.fn(),
			},
		},
		{ version: 1, suggestions: [] },
		"zh",
		{
			videoPath: "/ok.mp4",
			frames: [{ id: "click", timeMs: 2000, focus: { cx: 0.5, cy: 0.5 }, action: true }],
		},
	);

const image = { width: 2, height: 2, data: new Uint8Array(12) };

it("opens a fresh bundled OCR engine for each voice-over job and disposes it afterwards", async () => {
	const engines: OcrEngine[] = [];
	fixture.describe.mockImplementation(async (options: { ocr?: OcrEngine }) => {
		if (!options.ocr) throw new Error("no OCR engine");
		engines.push(options.ocr);
		// Opening the engine loads nothing; the first click read starts the worker.
		expect(await starts()).toBe(engines.length - 1);
		expect((await options.ocr.recognize(image))[0].text).toBe("Settings");
		expect(await starts()).toBe(engines.length);
		return new Map();
	});
	expect((await narrate()).success).toBe(true);
	expect((await narrate()).success).toBe(true);
	expect(engines).toHaveLength(2);
	expect(engines[0]).not.toBe(engines[1]);
	for (const engine of engines) await expect(engine.recognize(image)).rejects.toThrow(/disposed/);
	expect(fixture.close).toHaveBeenCalledTimes(2);
});

it("still disposes the OCR engine when the job fails", async () => {
	let engine: OcrEngine | undefined;
	fixture.describe.mockImplementation(async (options: { ocr?: OcrEngine }) => {
		engine = options.ocr;
		await options.ocr?.recognize(image);
		throw new Error("fixture failure");
	});
	expect((await narrate()).success).toBe(false);
	await expect(engine?.recognize(image)).rejects.toThrow(/disposed/);
});

it("narrates with the vision model alone, without a warning, when the build has no OCR", async () => {
	await fs.rm(path.join(ocrRoot, "manifest.json"));
	const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	fixture.describe.mockResolvedValue(new Map());
	try {
		expect((await narrate()).success).toBe(true);
		expect(fixture.describe.mock.calls[0][0].ocr).toBeUndefined();
		expect(warn).not.toHaveBeenCalled();
	} finally {
		warn.mockRestore();
	}
});

it("warns once and narrates without OCR when the OCR worker is missing from the build", async () => {
	await fs.rm(path.join(base, "dist-electron", "ocr-worker.cjs"));
	const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	fixture.describe.mockResolvedValue(new Map());
	try {
		expect((await narrate()).success).toBe(true);
		expect(fixture.describe.mock.calls[0][0].ocr).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
		expect(String(warn.mock.calls[0][1])).toMatch(/worker is missing/);
	} finally {
		warn.mockRestore();
	}
});
