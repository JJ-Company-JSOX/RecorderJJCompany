import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const mocks = vi.hoisted(() => ({
	exec: vi.fn(),
	readFile: vi.fn(),
	rm: vi.fn(),
	companions: vi.fn(),
	delay: vi.fn(),
	session: vi.fn(),
	vad: vi.fn(),
}));
vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => {
		const callback = args.pop() as (error: Error | null, result: unknown) => void;
		Promise.resolve()
			.then(() => mocks.exec(...args))
			.then(
				(result) => callback(null, result ?? { stderr: "" }),
				(error) => callback(error, undefined),
			);
	},
	spawnSync: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
	default: {
		access: vi.fn().mockResolvedValue(undefined),
		readFile: mocks.readFile,
		rm: mocks.rm,
	},
}));
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "/ffmpeg",
	getFfprobeBinaryPath: () => "/ffprobe",
}));
vi.mock("../paths/binaries", () => ({ getBundledWhisperExecutableCandidates: () => ["/whisper"] }));
vi.mock("../project/session", () => ({ resolveRecordingSession: mocks.session }));
vi.mock("../recording/diagnostics", () => ({
	getUsableCompanionAudioCandidates: mocks.companions,
	getCompanionAudioStartDelayMs: mocks.delay,
}));
vi.mock("../utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));
vi.mock("./vad", () => ({ detectBundledVoiceActivity: mocks.vad }));

import { generateAutoCaptionsFromVideo } from "./generate";

const options = { videoPath: "/video.mp4", whisperModelPath: "/model.bin" };
const srt = "1\n00:00:00,000 --> 00:00:02,000\nHello world.\n";
const json = JSON.stringify({
	transcription: [
		{
			offsets: { from: 0, to: 2000 },
			text: "Hello world.",
			tokens: [
				{ text: "Hello", offsets: { from: 0, to: 900 } },
				{ text: " world.", offsets: { from: 900, to: 2000 } },
			],
		},
	],
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.session.mockReset().mockResolvedValue(null);
	mocks.companions.mockReset().mockResolvedValue([]);
	mocks.delay.mockReset().mockResolvedValue(null);
	mocks.exec.mockReset().mockResolvedValue({ stderr: "" });
	mocks.readFile
		.mockReset()
		.mockImplementation(async (file: string) => (file.endsWith(".json") ? json : srt));
	mocks.rm.mockResolvedValue(undefined);
	mocks.vad
		.mockReset()
		.mockResolvedValue({ durationMs: 4000, segments: [{ startMs: 100, endMs: 1400 }] });
});

const whisperPath = path.resolve("/whisper");
const whisperCalls = () => mocks.exec.mock.calls.filter(([file]) => file === whisperPath);

describe("caption generation pipeline", () => {
	it("does not swallow cancellation during DTW duration probing and cleans its temporary outputs", async () => {
		const controller = new AbortController();
		mocks.exec.mockImplementation(async (file: string) => {
			if (file === "/ffprobe") {
				controller.abort();
				throw Object.assign(new Error("Cancelled probe"), { name: "AbortError" });
			}
			return { stderr: "" };
		});
		await expect(
			generateAutoCaptionsFromVideo({
				...options,
				useDtwAlignment: true,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.rm).toHaveBeenCalledTimes(3);
	});
	it("enables real DTW only on the bundled path and returns acoustic segment alignment with original token confidence", async () => {
		mocks.readFile.mockImplementation(async (file: string) =>
			file.endsWith(".json")
				? JSON.stringify({
						transcription: [
							{
								offsets: { from: 0, to: 2000 },
								text: "Hello world.",
								tokens: [
									{
										text: " Hello",
										offsets: { from: 0, to: 0 },
										t_dtw: 30,
										p: 0.8,
									},
									{
										text: " world.",
										offsets: { from: 0, to: 0 },
										t_dtw: 90,
										p: 0.6,
									},
								],
							},
						],
					})
				: srt,
		);
		mocks.exec.mockImplementation(async (file: string, args: string[]) =>
			file === "/ffprobe"
				? { stdout: JSON.stringify({ format: { duration: "4" } }) }
				: {
						stderr: args.some((arg) => arg.startsWith("silencedetect="))
							? "silence_start: 1.5\nsilence_end: 4\n"
							: "",
					},
		);
		const result = await generateAutoCaptionsFromVideo({ ...options, useDtwAlignment: true });
		expect(whisperCalls()[0][1]).toEqual(expect.arrayContaining(["-dtw", "small", "-nfa"]));
		expect(result.cues[0]).toMatchObject({
			text: "Hello world.",
			startMs: 0,
			endMs: 1580,
			alignment: "dtw-speech",
			confidence: 0.7,
		});
		expect(result.cues[0]).not.toHaveProperty("words");
		expect(result.cues[0].vadBoundaryVerified).toBe(true);
		const extractedWav = mocks.exec.mock.calls[0][1].at(-1);
		expect(mocks.vad).toHaveBeenCalledWith(extractedWav, undefined);
	});
	it("retains captions but disables speech deletion when VAD is missing or fails", async () => {
		mocks.vad.mockRejectedValue(new Error("missing VAD runtime"));
		const result = await generateAutoCaptionsFromVideo({ ...options, useDtwAlignment: true });
		expect(result.cues.length).toBeGreaterThan(0);
		expect(result.cues.every((cue) => cue.vadBoundaryVerified === false)).toBe(true);
	});
	it("propagates VAD cancellation and still cleans the extracted analysis WAV", async () => {
		const controller = new AbortController();
		mocks.vad.mockImplementation(async () => {
			controller.abort();
			controller.signal.throwIfAborted();
		});
		await expect(
			generateAutoCaptionsFromVideo({
				...options,
				useDtwAlignment: true,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.rm).toHaveBeenCalledTimes(3);
	});
	it("uses the approved candidate set without discovering additional media", async () => {
		const controller = new AbortController();
		await generateAutoCaptionsFromVideo({
			...options,
			signal: controller.signal,
			candidates: [{ path: "/approved.wav", label: "recording" }],
		});
		expect(mocks.companions).not.toHaveBeenCalled();
		expect(mocks.session).not.toHaveBeenCalled();
		expect(mocks.exec.mock.calls[0][1]).toContain("/approved.wav");
		for (const call of mocks.exec.mock.calls)
			expect(call[2]).toEqual(
				expect.objectContaining({ signal: controller.signal, windowsHide: true }),
			);
	});

	it("returns measured Whisper token confidence after phrase segmentation", async () => {
		mocks.readFile.mockImplementation(async (file: string) =>
			file.endsWith(".json")
				? JSON.stringify({
						transcription: [
							{
								offsets: { from: 0, to: 2000 },
								text: "Hello world.",
								tokens: [
									{ text: "Hello", offsets: { from: 0, to: 900 }, p: 0.9 },
									{ text: " world.", offsets: { from: 900, to: 2000 }, p: 0.7 },
								],
							},
						],
					})
				: srt,
		);
		const result = await generateAutoCaptionsFromVideo(options);
		expect(result.cues[0].confidence).toBeCloseTo(0.8);
	});

	it.each([
		"extraction",
		"whisper",
		"silence",
	])("cancellation during %s propagates and cleans temporary files", async (stage) => {
		const controller = new AbortController();
		mocks.exec.mockImplementation(async (file: string, args: string[]) => {
			const matches =
				stage === "extraction"
					? args.includes("pcm_s16le")
					: stage === "whisper"
						? file === whisperPath
						: args.some((arg) => arg.startsWith("silencedetect="));
			if (matches || (stage === "silence" && args.includes("-af"))) {
				controller.abort();
				throw Object.assign(new Error("unknown argument: -ojf"), { name: "AbortError" });
			}
			return { stderr: "" };
		});
		await expect(
			generateAutoCaptionsFromVideo({
				...options,
				signal: controller.signal,
				candidates: [
					{ path: "/mic.wav", label: "microphone audio sidecar" },
					{ path: "/second.wav", label: "system audio sidecar" },
				],
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.exec.mock.calls.some(([, args]) => args.includes("/second.wav"))).toBe(false);
		expect(mocks.rm).toHaveBeenCalledTimes(3);
		if (stage === "whisper") expect(whisperCalls()).toHaveLength(1);
	});

	it("fails clearly for missing audio instead of synthesizing captions", async () => {
		mocks.exec.mockImplementation(async (file: string) => {
			if (file === "/ffprobe") return { stdout: JSON.stringify({ streams: [] }) };
			throw Error("No audio stream");
		});
		await expect(
			generateAutoCaptionsFromVideo({
				...options,
				candidates: [{ path: "/video.mp4", label: "recording" }],
			}),
		).rejects.toThrow("No audio was found");
		expect(whisperCalls()).toHaveLength(0);
	});
	it("transcribes both sidecars independently, preserving the microphone delay", async () => {
		mocks.companions.mockResolvedValue([
			{
				platform: "mac",
				micPath: "/video.mic.wav",
				systemPath: "/video.system.wav",
				usablePaths: ["/video.system.wav", "/video.mic.wav"],
			},
		]);
		mocks.delay.mockResolvedValue(450);
		const result = await generateAutoCaptionsFromVideo(options);
		expect(result.audioSourceLabel).toBe("microphone and system audio");
		expect(whisperCalls()).toHaveLength(2);
		expect(mocks.exec.mock.calls.some(([, args]) => args.includes("/video.system.wav"))).toBe(
			true,
		);
		expect(mocks.exec.mock.calls[0][1]).toEqual(
			expect.arrayContaining(["-i", "/video.mic.wav", "-af", "adelay=450:all=1"]),
		);
	});

	it("falls back to embedded audio when the microphone is confirmed to have no audio stream", async () => {
		mocks.companions.mockResolvedValue([
			{
				platform: "mac",
				micPath: "/video.mic.wav",
				systemPath: "/video.system.wav",
				usablePaths: ["/video.mic.wav"],
			},
		]);
		mocks.exec.mockImplementation(async (file: string, args: string[]) => {
			if (file === "/ffprobe") return { stdout: JSON.stringify({ streams: [] }) };
			if (args.includes("/video.mic.wav")) throw new Error("unreadable microphone");
			return { stderr: "" };
		});
		const result = await generateAutoCaptionsFromVideo(options);
		expect(result.cues[0].text).toBe("Hello world.");
		expect(result.audioSourceLabel).toBe("recording");
	});
	it("does not silently drop a broken microphone from a combined speech analysis", async () => {
		mocks.companions.mockResolvedValue([
			{
				platform: "win",
				micPath: "/video.mic.wav",
				systemPath: "/video.system.wav",
				usablePaths: ["/video.mic.wav"],
			},
		]);
		mocks.exec.mockImplementation(async (file: string, args: string[]) => {
			if (file === "/ffprobe") return { stdout: JSON.stringify({ streams: [{ index: 0 }] }) };
			if (args.includes("/video.mic.wav")) throw Error("decoder failed");
			return { stderr: "" };
		});
		await expect(generateAutoCaptionsFromVideo(options)).rejects.toMatchObject({
			code: "AUDIO_EXTRACTION_FAILED",
		});
		expect(whisperCalls()).toHaveLength(0);
	});

	it("extracts mono audio, transcribes, segments word timings and cleans up", async () => {
		const result = await generateAutoCaptionsFromVideo(options);
		expect(result.cues[0].text).toBe("Hello world.");
		expect(result.cues[0].words).toHaveLength(2);
		expect(mocks.exec.mock.calls[0][1]).toEqual(
			expect.arrayContaining(["-ac", "1", "-ar", "16000"]),
		);
		expect(whisperCalls()).toHaveLength(1);
		expect(whisperCalls()[0][1]).toEqual(expect.arrayContaining(["-mc", "0"]));
		expect(mocks.rm).toHaveBeenCalledTimes(3);
	});

	it("retries SRT only for a runtime that rejects full JSON", async () => {
		mocks.exec.mockImplementation(async (file: string, args: string[]) => {
			if (file === whisperPath && args.includes("-ojf"))
				throw new Error("unknown argument: -ojf");
			return { stderr: "" };
		});
		expect((await generateAutoCaptionsFromVideo(options)).cues).toHaveLength(1);
		expect(whisperCalls()).toHaveLength(2);
		expect(whisperCalls()[1][1]).not.toContain("-ojf");
	});

	it("keeps transcription when optional silence detection fails", async () => {
		mocks.exec.mockImplementation(async (_file: string, args: string[]) => {
			if (args.includes("-af")) throw new Error("silence filter failed");
			return { stderr: "" };
		});
		expect((await generateAutoCaptionsFromVideo(options)).cues[0].text).toBe("Hello world.");
	});
});

it("falls back to linked webcam audio when mic exists and other secondary sources fail", async () => {
	mocks.session.mockResolvedValue({ webcamPath: "/webcam.mp4" });
	mocks.companions.mockResolvedValue([
		{
			platform: "mac",
			micPath: "/video.mic.wav",
			systemPath: "/video.system.wav",
			usablePaths: ["/video.mic.wav", "/video.system.wav"],
		},
	]);
	mocks.exec.mockImplementation(async (file: string, args: string[]) => {
		if (file === "/ffmpeg" && args.includes("pcm_s16le")) {
			const source = args[args.indexOf("-i") + 1];
			if (source === "/video.mp4" || source === "/video.system.wav")
				throw new Error("No audio");
		}
		return { stderr: "" };
	});
	const result = await generateAutoCaptionsFromVideo(options);
	expect(result.cues.length).toBeGreaterThan(0);
	expect(
		mocks.exec.mock.calls.some(
			([file, args]) => file === "/ffmpeg" && args.includes("/webcam.mp4"),
		),
	).toBe(true);
});
