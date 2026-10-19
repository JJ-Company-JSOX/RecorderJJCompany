import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>(),
	approved: vi.fn(),
	media: vi.fn(),
	recognize: vi.fn(),
	start: vi.fn(),
	close: vi.fn(),
	complete: vi.fn(),
	vision: vi.fn(),
	callbacks: new Map<string, () => void>(),
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
vi.mock("../autoEdit/media", () => ({ analyzeLocalMedia: fixture.media }));
vi.mock("../autoEdit/vision", () => ({ analyzeVideoFrames: fixture.vision }));
vi.mock("../autoEdit/reviewer", () => ({
	inspectLocalModel: vi.fn(),
	LocalPlanReviewer: class {},
}));
vi.mock("../captions/generate", () => ({
	resolveCaptionAudioCandidates: async () => [{ path: "/approved.mp4", label: "recording" }],
}));
vi.mock("../captions/bundledSpeech", () => ({
	generateBundledSpeechTranscript: fixture.recognize,
	getBundledSpeechStatus: vi.fn(),
}));
vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "/ffmpeg",
	getFfprobeBinaryPath: () => "/ffprobe",
}));
vi.mock("../project/manager", () => ({ resolveApprovedLocalMediaPath: fixture.approved }));
vi.mock("../recording/diagnostics", () => ({ getCompanionAudioStartDelayMs: async () => 0 }));
vi.mock("../utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));
import { registerAutoEditHandlers } from "./autoEdit";
const event = () => ({
	sender: {
		id: 7,
		isDestroyed: () => false,
		send: vi.fn(),
		once: (name: string, callback: () => void) => fixture.callbacks.set(name, callback),
		removeListener: vi.fn(),
	},
});
beforeEach(() => {
	vi.clearAllMocks();
	fixture.handlers.clear();
	fixture.callbacks.clear();
	fixture.approved.mockResolvedValue("/approved.mp4");
	fixture.media.mockResolvedValue({
		durationMs: 6000,
		staticRanges: [],
		silentRanges: [],
		audioVerified: true,
		warnings: [],
	});
	fixture.recognize.mockResolvedValue({
		cues: [
			{
				id: "a",
				text: "Save",
				startMs: 200,
				endMs: 1200,
				confidence: 0.99,
				words: [{ text: "Save", startMs: 300, endMs: 1000 }],
			},
		],
	});
	fixture.complete.mockResolvedValue('{"edits":[]}');
	fixture.start.mockResolvedValue({
		close: fixture.close,
		complete: fixture.complete,
		describe: vi.fn(),
	});
	fixture.vision.mockResolvedValue({ observations: [] });
	registerAutoEditHandlers();
});
it("refuses unapproved media before analysis or model startup", async () => {
	fixture.approved.mockResolvedValue(null);
	const result = await fixture.handlers.get("auto-edit-complete")!(event(), {
		videoPath: "/private.mp4",
	});
	expect(result.success).toBe(false);
	expect(fixture.recognize).not.toHaveBeenCalled();
	expect(fixture.start).not.toHaveBeenCalled();
});
it("does not load reasoning models when speech recognition finds nothing", async () => {
	fixture.recognize.mockResolvedValue({ cues: [] });
	const result = await fixture.handlers.get("auto-edit-complete")!(event(), {
		videoPath: "/approved.mp4",
	});
	expect(result.error).toContain("No usable speech");
	expect(fixture.start).not.toHaveBeenCalled();
});
it("passes only approved sources, grounds transcript, and closes model after vision failure", async () => {
	fixture.vision.mockRejectedValue(Error("fixture vision failure"));
	const result = await fixture.handlers.get("auto-edit-complete")!(event(), {
		videoPath: "/approved.mp4",
	});
	expect(result.success).toBe(false);
	expect(fixture.close).toHaveBeenCalledOnce();
	expect(fixture.recognize.mock.calls[0][0].candidates).toEqual([
		{ path: "/approved.mp4", label: "recording" },
	]);
	// No lexical repeat exists in this fixture: don't ask a model to invent a cut.
	expect(fixture.complete).not.toHaveBeenCalled();
});
it("cancel aborts ASR and allows a later job for the same renderer", async () => {
	fixture.recognize.mockImplementationOnce(
		({ signal }) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(Error("canceled")), { once: true });
			}),
	);
	const sender = event();
	const pending = fixture.handlers.get("auto-edit-complete")!(sender, {
		videoPath: "/approved.mp4",
	});
	await vi.waitFor(() => expect(fixture.recognize).toHaveBeenCalledOnce());
	fixture.handlers.get("auto-edit-cancel")!(sender);
	expect((await pending).success).toBe(false);
	expect(fixture.start).not.toHaveBeenCalled();
	expect(
		(await fixture.handlers.get("auto-edit-complete")!(sender, { videoPath: "/approved.mp4" }))
			.success,
	).toBe(true);
});
