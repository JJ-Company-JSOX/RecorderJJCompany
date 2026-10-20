import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ exec: vi.fn(), access: vi.fn() }));
vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => {
		const callback = args.pop() as (error: unknown, value?: unknown) => void;
		Promise.resolve()
			.then(() => fixture.exec(...args))
			.then(
				(value) => callback(null, value),
				(error) => callback(error),
			);
	},
	spawnSync: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ default: { access: fixture.access } }));
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "/ffmpeg",
	getFfprobeBinaryPath: () => "/ffprobe",
}));
vi.mock("../recording/diagnostics", () => ({
	getUsableCompanionAudioCandidates: async () => [],
	getCompanionAudioStartDelayMs: async () => null,
}));
vi.mock("../project/session", () => ({ resolveRecordingSession: async () => null }));
vi.mock("../utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));
import { extractCaptionAudioSource } from "./generate";
const options = {
	videoPath: "/private/video.mp4",
	ffmpegPath: "/ffmpeg",
	wavPath: "/temp/output.wav",
	candidates: [{ path: "/private/video.mp4", label: "recording" }],
};
beforeEach(() => {
	fixture.access.mockReset().mockResolvedValue(undefined);
	fixture.exec.mockReset().mockImplementation(async (file: string) => {
		if (file === "/ffprobe") return { stdout: JSON.stringify({ streams: [] }) };
		throw Error("arbitrary FFmpeg failure text");
	});
});
it("reports no audio only after a valid probe confirms no stream", async () => {
	await expect(extractCaptionAudioSource(options)).rejects.toMatchObject({
		code: "NO_AUDIO",
		attempts: [{ label: "recording", readable: true, outcome: "no-audio" }],
	});
});
it.each([
	"not JSON",
	JSON.stringify({ format: {} }),
])("does not confuse an invalid probe with absent audio: %s", async (stdout) => {
	fixture.exec.mockImplementation(async (file: string) => {
		if (file === "/ffprobe") return { stdout };
		throw Error("failed");
	});
	await expect(extractCaptionAudioSource(options)).rejects.toMatchObject({
		code: "AUDIO_EXTRACTION_FAILED",
		attempts: [{ outcome: "probe-failed" }],
	});
});
it("reports an extraction failure when an audio stream exists, without leaking source paths", async () => {
	fixture.exec.mockImplementation(async (file: string) => {
		if (file === "/ffprobe") return { stdout: JSON.stringify({ streams: [{ index: 1 }] }) };
		throw Error("failed /private/video.mp4");
	});
	const error = await extractCaptionAudioSource(options).catch((error) => error);
	expect(error).toMatchObject({
		code: "AUDIO_EXTRACTION_FAILED",
		attempts: [{ outcome: "extraction-failed" }],
	});
	expect(JSON.stringify(error)).not.toContain("/private");
});
it("marks unreadable sources accurately and never launches a decoder for them", async () => {
	fixture.access.mockRejectedValue(Error("access denied"));
	await expect(extractCaptionAudioSource(options)).rejects.toMatchObject({
		code: "AUDIO_EXTRACTION_FAILED",
		attempts: [{ readable: false, outcome: "unreadable" }],
	});
	expect(fixture.exec).not.toHaveBeenCalled();
});
it("preserves cancellation during the classification probe", async () => {
	const controller = new AbortController();
	fixture.exec.mockImplementation(async (file: string) => {
		if (file === "/ffprobe") controller.abort();
		throw Error("failed");
	});
	await expect(
		extractCaptionAudioSource({ ...options, signal: controller.signal }),
	).rejects.toMatchObject({ name: "AbortError" });
});
it("keeps successful extraction fast without a probe", async () => {
	fixture.exec.mockResolvedValue({ stderr: "" });
	await expect(extractCaptionAudioSource(options)).resolves.toEqual(options.candidates[0]);
	expect(fixture.exec).toHaveBeenCalledOnce();
});
it("continues to a usable source rather than failing on an earlier candidate", async () => {
	fixture.exec.mockImplementation(async (_file: string, args: string[]) => {
		if (args.includes("/valid.wav")) return { stderr: "" };
		throw Error("bad source");
	});
	const valid = { path: "/valid.wav", label: "system audio sidecar" };
	await expect(
		extractCaptionAudioSource({ ...options, candidates: [...options.candidates, valid] }),
	).resolves.toEqual(valid);
});
