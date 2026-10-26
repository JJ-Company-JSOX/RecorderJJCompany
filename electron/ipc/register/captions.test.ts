import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
	handlers: new Map<string, (...args: any[]) => Promise<any>>(),
	quit: [] as (() => void)[],
	status: vi.fn(),
	bundled: vi.fn(),
	legacy: vi.fn(),
	candidates: vi.fn(),
	approve: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { once: (_name: string, callback: () => void) => fixture.quit.push(callback) },
	ipcMain: {
		handle: (name: string, handler: (...args: any[]) => Promise<any>) =>
			fixture.handlers.set(name, handler),
	},
}));
vi.mock("../captions/bundledSpeech", () => ({
	getBundledSpeechStatus: fixture.status,
	generateBundledSpeechTranscript: fixture.bundled,
}));
vi.mock("../captions/generate", () => ({
	NoCaptionAudioError: class extends Error {},
	generateAutoCaptionsFromVideo: fixture.legacy,
	resolveCaptionAudioCandidates: fixture.candidates,
}));
vi.mock("../captions/whisper", () => ({
	cancelWhisperModelDownload: vi.fn(),
	deleteWhisperSmallModel: vi.fn(),
	downloadWhisperSmallModel: vi.fn(),
	getWhisperSmallModelStatus: vi.fn(),
	sendWhisperModelDownloadProgress: vi.fn(),
}));
vi.mock("../constants", () => ({
	LEGACY_PROJECT_FILE_EXTENSIONS: [],
	PROJECT_FILE_EXTENSION: "recordly",
}));
vi.mock("../fileDialogs", () => ({ showOpenDialogForSender: vi.fn() }));
vi.mock("../project/manager", () => ({
	hasProjectFileExtension: vi.fn(),
	loadProjectFromPath: vi.fn(),
	resolveApprovedLocalMediaPath: fixture.approve,
}));
vi.mock("../state", () => ({ setCurrentProjectPath: vi.fn() }));
vi.mock("../utils", () => ({
	approveUserPath: vi.fn(),
	getRecordingsDir: vi.fn(),
	normalizeVideoSourcePath: (value: string) => value,
}));
import { NoCaptionAudioError } from "../captions/generate";
import { registerCaptionHandlers } from "./captions";
const event = (id = 1) => ({
	sender: Object.assign(new EventEmitter(), { id, isDestroyed: () => false, send: vi.fn() }),
});
const options = { videoPath: "/approved.mp4", whisperModelPath: "", language: "en" };
const invoke = (sender = event(), input: unknown = options) =>
	fixture.handlers.get("generate-auto-captions")!(sender, input);
beforeEach(() => {
	vi.clearAllMocks();
	fixture.handlers.clear();
	fixture.quit.length = 0;
	fixture.status.mockResolvedValue({ available: true, modelPath: "/bundled.bin" });
	fixture.approve.mockImplementation(async (value) => value);
	fixture.candidates.mockResolvedValue([{ path: "/approved.mp4", label: "recording" }]);
	fixture.bundled.mockResolvedValue({
		cues: [{ id: "cue", startMs: 0, endMs: 1000, text: "Hello" }],
		audioSourceLabel: "recording",
	});
	registerCaptionHandlers();
});
it("uses the caption-only bundled engine with a real abort signal and stage progress", async () => {
	const e = event();
	expect(await invoke(e)).toMatchObject({ success: true, cues: [{ text: "Hello" }] });
	expect(fixture.bundled).toHaveBeenCalledWith(
		expect.objectContaining({
			videoPath: "/approved.mp4",
			signal: expect.any(AbortSignal),
			language: "en",
		}),
	);
	expect(e.sender.send.mock.calls.map((c) => c[1])).toEqual([
		{ phase: "preparing" },
		{ phase: "transcribing" },
		{ phase: "complete", cueCount: 1 },
	]);
	expect(e.sender.listenerCount("destroyed")).toBe(0);
});
it("forwards cancellation to a selected legacy runtime as well", async () => {
	fixture.status.mockResolvedValue({ available: false });
	fixture.legacy.mockResolvedValue({
		cues: [{ id: "c", startMs: 0, endMs: 100, text: "Word" }],
		audioSourceLabel: "microphone",
	});
	expect(
		await invoke(event(), {
			...options,
			whisperExecutablePath: "/whisper",
			whisperModelPath: "/custom.bin",
		}),
	).toMatchObject({ success: true });
	expect(fixture.legacy).toHaveBeenCalledWith(
		expect.objectContaining({
			signal: expect.any(AbortSignal),
			whisperExecutablePath: "/whisper",
		}),
	);
});
it("locks per sender, cancels only that sender and rejects a late successful result", async () => {
	const e = event();
	let complete!: (value: unknown) => void;
	let signal!: AbortSignal;
	fixture.bundled.mockImplementationOnce((input) => {
		signal = input.signal;
		return new Promise((resolve) => (complete = resolve));
	});
	const pending = invoke(e);
	await vi.waitFor(() => expect(fixture.bundled).toHaveBeenCalled());
	expect(await invoke(e)).toMatchObject({ success: false, errorCode: "busy" });
	expect(await fixture.handlers.get("cancel-auto-caption-generation")!(event(2))).toEqual({
		success: true,
		cancelled: false,
	});
	expect(signal.aborted).toBe(false);
	expect(await fixture.handlers.get("cancel-auto-caption-generation")!(e)).toEqual({
		success: true,
		cancelled: true,
	});
	expect(signal.aborted).toBe(true);
	complete({ cues: [{ text: "Late" }] });
	expect(await pending).toMatchObject({ success: false, errorCode: "cancelled" });
	expect(e.sender.listenerCount("destroyed")).toBe(0);
	fixture.bundled.mockResolvedValue({ cues: [{ text: "Retry" }], audioSourceLabel: "recording" });
	expect(await invoke(e)).toMatchObject({ success: true });
});
it.each([
	"destroyed",
	"quit",
])("aborts the speech process on %s and releases the running job", async (reason) => {
	const e = event();
	let finish!: (value: unknown) => void;
	let signal!: AbortSignal;
	fixture.bundled.mockImplementationOnce((input) => {
		signal = input.signal;
		return new Promise((resolve) => (finish = resolve));
	});
	const pending = invoke(e);
	await vi.waitFor(() => expect(fixture.bundled).toHaveBeenCalled());
	if (reason === "quit") fixture.quit[0]();
	else e.sender.emit("destroyed");
	expect(signal.aborted).toBe(true);
	finish({ cues: [] });
	expect(await pending).toMatchObject({ success: false, errorCode: "cancelled" });
	expect(e.sender.listenerCount("destroyed")).toBe(0);
});
it("distinguishes no audio from no recognized speech without string matching", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
	try {
		fixture.bundled.mockRejectedValueOnce(new NoCaptionAudioError("Missing audio"));
		expect(await invoke()).toMatchObject({ success: false, errorCode: "no-audio" });
		fixture.bundled.mockResolvedValueOnce({ cues: [], audioSourceLabel: "recording" });
		expect(await invoke()).toMatchObject({ success: false, errorCode: "no-speech", cues: [] });
	} finally {
		error.mockRestore();
	}
});
it("rejects malformed input and unapproved linked paths before starting speech recognition", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
	try {
		expect(await invoke(event(), null)).toMatchObject({
			success: false,
			errorCode: "invalid-input",
		});
		fixture.approve.mockResolvedValueOnce(null);
		expect(await invoke()).toMatchObject({ success: false, errorCode: "not-approved" });
		fixture.candidates.mockResolvedValue([{ path: "/denied.wav", label: "microphone" }]);
		fixture.approve.mockImplementation(async (value) =>
			value === "/denied.wav" ? null : value,
		);
		expect(await invoke()).toMatchObject({ success: false, errorCode: "not-approved" });
		expect(fixture.bundled).not.toHaveBeenCalled();
	} finally {
		error.mockRestore();
	}
});
