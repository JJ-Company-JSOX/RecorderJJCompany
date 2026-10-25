import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const fixture = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>(),
	start: vi.fn(),
	close: vi.fn(),
	describe: vi.fn(),
	narrate: vi.fn(),
	reviewLocal: vi.fn(),
	narrateLocal: vi.fn(),
	story: vi.fn(),
	approve: vi.fn(),
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
	LocalNarrationGenerator: class {
		generate = fixture.narrateLocal;
	},
}));
vi.mock("../autoEdit/story", () => ({ generateLocalStory: fixture.story }));
vi.mock("../autoEdit/media", () => ({ analyzeLocalMedia: vi.fn() }));
vi.mock("../autoEdit/vision", () => ({ analyzeVideoFrames: vi.fn() }));
vi.mock("../autoEdit/reviewer", () => ({
	inspectLocalModel: vi.fn(),
	LocalPlanReviewer: class {
		review = fixture.reviewLocal;
	},
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
vi.mock("../project/manager", () => ({ resolveApprovedLocalMediaPath: fixture.approve }));
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
	fixture.approve.mockResolvedValue("/ok.mp4");
	fixture.story.mockResolvedValue({ cues: [] });
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

it.each([
	"auto-edit-review-local",
	"auto-edit-narrate-local",
])("cancels %s, prevents competing work and ignores a late result", async (name) => {
	registerAutoEditHandlers();
	const sender = Object.assign(new EventEmitter(), { id: 81 });
	const event = { sender };
	let finish!: (value: unknown) => void;
	let signal!: AbortSignal;
	const operation = name.includes("review") ? fixture.reviewLocal : fixture.narrateLocal;
	operation.mockImplementation((_plan, _model, abortSignal) => {
		signal = abortSignal;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const first = fixture.handlers.get(name)!(event, plan, "local", "zh");
	expect(signal.aborted).toBe(false);
	expect(sender.listenerCount("destroyed")).toBe(1);
	expect(await fixture.handlers.get(name)!(event, plan, "local")).toMatchObject({
		success: false,
		error: "Analysis already running",
	});
	await fixture.handlers.get("auto-edit-cancel")!(event);
	expect(signal.aborted).toBe(true);
	finish({ cues: [] });
	expect(await first).toMatchObject({ success: false });
	expect(sender.listenerCount("destroyed")).toBe(0);
	operation.mockResolvedValueOnce({ cues: [] });
	expect(await fixture.handlers.get(name)!(event, plan, "local", "zh")).toMatchObject({
		success: true,
	});
	expect(sender.listenerCount("destroyed")).toBe(0);
});

it("aborts Ollama narration when the editor is destroyed and forwards the requested language", async () => {
	registerAutoEditHandlers();
	const sender = Object.assign(new EventEmitter(), { id: 82 });
	let finish!: () => void;
	fixture.narrateLocal.mockImplementation((_plan, _model, signal, language) => {
		expect(language).toBe("zh");
		return new Promise((resolve) => {
			finish = () => {
				expect(signal.aborted).toBe(true);
				resolve({ cues: [] });
			};
		});
	});
	const request = fixture.handlers.get("auto-edit-narrate-local")!(
		{ sender },
		plan,
		"local",
		"zh",
	);
	sender.emit("destroyed");
	finish();
	expect(await request).toMatchObject({ success: false });
	expect(sender.listenerCount("destroyed")).toBe(0);
});

const storyRequest = () => ({
	brief: {
		topic: "My product",
		audience: "Customers",
		facts: "Works offline",
		ending: "Try it",
		notes: "",
		analyzeVideo: true,
	},
	videoPath: "/ok.mp4",
	scenes: [{ id: "story-1", startMs: 0, endMs: 5000, sourceTimeMs: 2500 }],
});
it("validates and approves story media before allowing model work", async () => {
	registerAutoEditHandlers();
	const handler = fixture.handlers.get("auto-edit-story-local")!;
	expect(await handler(event(), { ...storyRequest(), scenes: [] }, "local", "en")).toMatchObject({
		success: false,
	});
	expect(fixture.story).not.toHaveBeenCalled();
	fixture.approve.mockResolvedValueOnce(null);
	expect(await handler(event(), storyRequest(), "local", "en")).toMatchObject({
		success: false,
		error: "Select an approved local recording first",
	});
	expect(fixture.story).not.toHaveBeenCalled();
	expect(await handler(event(), storyRequest(), "local", "en")).toMatchObject({ success: true });
	expect(fixture.story).toHaveBeenCalledWith(
		expect.objectContaining({
			approvedPath: "/ok.mp4",
			language: "en",
			model: "local",
			signal: expect.any(AbortSignal),
		}),
	);
});
it("cancels a story and discards late output without retaining a running job", async () => {
	registerAutoEditHandlers();
	const sender = Object.assign(new EventEmitter(), {
		id: 91,
		isDestroyed: () => false,
		send: vi.fn(),
	});
	let finish!: () => void;
	let signal!: AbortSignal;
	fixture.story.mockImplementation((options) => {
		signal = options.signal;
		return new Promise((resolve) => {
			finish = () => resolve({ cues: [] });
		});
	});
	const handler = fixture.handlers.get("auto-edit-story-local")!;
	const pending = handler({ sender }, storyRequest(), "local", "en");
	await vi.waitFor(() => expect(fixture.story).toHaveBeenCalled());
	expect(await handler({ sender }, storyRequest(), "local", "en")).toMatchObject({
		success: false,
		error: "Analysis already running",
	});
	await fixture.handlers.get("auto-edit-cancel")!({ sender });
	expect(signal.aborted).toBe(true);
	finish();
	expect(await pending).toMatchObject({ success: false });
	expect(sender.listenerCount("destroyed")).toBe(0);
});
