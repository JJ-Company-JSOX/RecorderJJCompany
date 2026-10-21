import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>(),
	start: vi.fn(),
	close: vi.fn(),
	describe: vi.fn(),
	narrate: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { isPackaged: false, getAppPath: () => "/app", once: vi.fn() },
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => Promise<Record<string, unknown>>) =>
			fixture.handlers.set(name, handler),
	},
}));
vi.mock("../autoEdit/bundled", () => ({
	bundledAiStatus: vi.fn(),
	startBundledAi: fixture.start,
	stopBundledAi: vi.fn(),
}));
vi.mock("../autoEdit/narrationFrames", () => ({
	describeNarrationFrames: fixture.describe,
	isNarrationFrame: () => true,
}));
vi.mock("../autoEdit/narrator", () => ({
	generateBundledNarration: fixture.narrate,
	isNarrationLanguage: (value: unknown) => value === "en" || value === "zh",
	LocalNarrationGenerator: class {},
}));
vi.mock("../autoEdit/media", () => ({ analyzeLocalMedia: vi.fn() }));
vi.mock("../autoEdit/vision", () => ({ analyzeVideoFrames: vi.fn() }));
vi.mock("../autoEdit/reviewer", () => ({
	inspectLocalModel: vi.fn(),
	LocalPlanReviewer: class {},
}));
vi.mock("../captions/generate", () => ({
	NoCaptionAudioError: class extends Error {},
	resolveCaptionAudioCandidates: vi.fn(),
}));
vi.mock("../captions/bundledSpeech", () => ({
	generateBundledSpeechTranscript: vi.fn(),
	getBundledSpeechStatus: vi.fn(),
}));
vi.mock("../recording/diagnostics", () => ({ getCompanionAudioStartDelayMs: async () => 0 }));
vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "/ffmpeg",
	getFfprobeBinaryPath: () => "/ffprobe",
}));
vi.mock("../project/manager", () => ({ resolveApprovedLocalMediaPath: async () => "/ok.mp4" }));
vi.mock("../utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));
import type { OcrEngine } from "../autoEdit/ocrTypes";
import { registerAutoEditHandlers } from "./autoEdit";

const event = () => ({
	sender: {
		id: 3,
		isDestroyed: () => false,
		send: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
});
const plan = { version: 1, suggestions: [] };
const screen = {
	videoPath: "/ok.mp4",
	frames: [{ id: "click", timeMs: 2000, focus: { cx: 0.5, cy: 0.5 }, action: true }],
};
const narrate = () =>
	fixture.handlers.get("auto-edit-narrate-bundled")!(event(), plan, "en", screen);

beforeEach(() => {
	vi.clearAllMocks();
	fixture.handlers.clear();
	fixture.start.mockResolvedValue({ close: fixture.close, complete: vi.fn(), look: vi.fn() });
	fixture.describe.mockResolvedValue(new Map());
	fixture.narrate.mockResolvedValue({ cues: [] });
});

it("gives the narration pass the bundled OCR engine when the build has one, then disposes it", async () => {
	const ocr: OcrEngine = { recognize: vi.fn(), dispose: vi.fn(async () => undefined) };
	const openOcr = vi.fn(async () => ocr);
	registerAutoEditHandlers({ openOcr });
	expect((await narrate()).success).toBe(true);
	expect(openOcr).toHaveBeenCalledOnce();
	expect(fixture.describe.mock.calls[0][0]).toMatchObject({
		videoPath: "/ok.mp4",
		ffmpegPath: "/ffmpeg",
		ffprobePath: "/ffprobe",
		ocr,
	});
	expect(ocr.dispose).toHaveBeenCalledOnce();
	expect(fixture.close).toHaveBeenCalledOnce();
});

it("keeps the vision-only voice-over when OCR is missing or fails to open", async () => {
	registerAutoEditHandlers();
	expect((await narrate()).success).toBe(true);
	expect(fixture.describe.mock.calls[0][0].ocr).toBeUndefined();
	fixture.handlers.clear();
	const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	registerAutoEditHandlers({
		openOcr: async () => {
			throw Error("OCR model missing");
		},
	});
	expect((await narrate()).success).toBe(true);
	expect(fixture.describe.mock.calls[1][0].ocr).toBeUndefined();
	expect(warn).toHaveBeenCalled();
	warn.mockRestore();
});

it("disposes the OCR engine even when the narration fails", async () => {
	const ocr: OcrEngine = { recognize: vi.fn(), dispose: vi.fn(async () => undefined) };
	registerAutoEditHandlers({ openOcr: async () => ocr });
	fixture.describe.mockRejectedValueOnce(Error("fixture failure"));
	expect((await narrate()).success).toBe(false);
	expect(ocr.dispose).toHaveBeenCalledOnce();
	expect(fixture.close).toHaveBeenCalledOnce();
});
