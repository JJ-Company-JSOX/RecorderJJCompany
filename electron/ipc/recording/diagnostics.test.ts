import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

describe("getCompanionAudioFallbackPaths", () => {
	let tempRoot: string;
	let appDataPath: string;
	let userDataPath: string;
	let tempPath: string;
	let appPath: string;
	let execFileMock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-companion-audio-"));
		appDataPath = path.join(tempRoot, "AppData");
		userDataPath = path.join(tempRoot, "UserData");
		tempPath = path.join(tempRoot, "Temp");
		appPath = path.join(tempRoot, "App");
		await Promise.all(
			[appDataPath, userDataPath, tempPath, appPath].map((dirPath) =>
				fs.mkdir(dirPath, { recursive: true }),
			),
		);
		execFileMock = vi.fn(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				callback(null, "", "");
			},
		);

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => appPath,
				getPath: (name: string) => {
					if (name === "appData") return appDataPath;
					if (name === "userData") return userDataPath;
					if (name === "temp") return tempPath;
					return tempRoot;
				},
				setPath: () => undefined,
			},
		}));
		vi.doMock("node:child_process", () => ({
			execFile: execFileMock,
		}));
		vi.doMock("../ffmpeg/binary", () => ({
			getFfmpegBinaryPath: () => "ffmpeg",
			getFfprobeBinaryPath: () => "ffprobe",
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("node:child_process");
		vi.doUnmock("../ffmpeg/binary");
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("returns companion audio files directly when the video has no embedded audio", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const systemPath = path.join(tempRoot, "recording.system.wav");
		const micPath = path.join(tempRoot, "recording.mic.wav");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(systemPath, "system"),
			fs.writeFile(micPath, "mic"),
		]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe failed") as Error & { stderr?: string };
				error.stderr = "Stream #0:0: Video: h264";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackPaths } = await import("./diagnostics");

		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([
			systemPath,
			micPath,
		]);
	});

	it("keeps the embedded source audio and adds the mic companion when both are present", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const systemPath = path.join(tempRoot, "recording.system.wav");
		const micPath = path.join(tempRoot, "recording.mic.wav");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(systemPath, "system"),
			fs.writeFile(micPath, "mic"),
		]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe found embedded audio") as Error & {
					stderr?: string;
				};
				error.stderr = "Stream #0:1: Audio: aac";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackPaths } = await import("./diagnostics");

		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([
			videoPath,
			micPath,
		]);
	});

	it("returns both mac sidecars instead of the video when a system sidecar exists", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const systemPath = path.join(tempRoot, "recording.system.m4a");
		const micPath = path.join(tempRoot, "recording.mic.m4a");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(systemPath, "system"),
			fs.writeFile(micPath, "mic"),
		]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe found embedded audio") as Error & {
					stderr?: string;
				};
				error.stderr = "Stream #0:1: Audio: aac";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackPaths } = await import("./diagnostics");

		// The inline mp4 track holds system audio only, so returning [videoPath]
		// here silently dropped the microphone.
		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([
			systemPath,
			micPath,
		]);
	});

	it("prefers the mac mic companion alone when embedded audio already exists and no system sidecar is present", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const micPath = path.join(tempRoot, "recording.mic.m4a");

		await Promise.all([fs.writeFile(videoPath, "video"), fs.writeFile(micPath, "mic")]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe found embedded audio") as Error & {
					stderr?: string;
				};
				error.stderr = "Stream #0:1: Audio: aac";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackPaths } = await import("./diagnostics");

		await expect(getCompanionAudioFallbackPaths(videoPath)).resolves.toEqual([micPath]);
	});

	it("loads saved sidecar timing metadata alongside companion audio paths", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const micPath = path.join(tempRoot, "recording.mic.webm");

		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(micPath, "mic"),
			fs.writeFile(`${micPath}.json`, `\ufeff${JSON.stringify({ startDelayMs: 2750 })}`),
		]);

		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				const error = new Error("ffmpeg probe failed") as Error & { stderr?: string };
				error.stderr = "Stream #0:0: Video: h264";
				callback(error, "", error.stderr);
			},
		);

		const { getCompanionAudioFallbackInfo } = await import("./diagnostics");

		await expect(getCompanionAudioFallbackInfo(videoPath)).resolves.toEqual({
			paths: [micPath],
			startDelayMsByPath: {
				[micPath]: 2750,
			},
		});
	});

	it("scales audio mux timeout for long recordings", async () => {
		const { getRecordingAudioMuxTimeoutMs } = await import("./diagnostics");

		expect(getRecordingAudioMuxTimeoutMs(0)).toBe(5 * 60 * 1000);
		expect(getRecordingAudioMuxTimeoutMs(29 * 60 + 29.41)).toBeGreaterThan(120000);
		expect(getRecordingAudioMuxTimeoutMs(29 * 60 + 29.41)).toBeCloseTo(
			(29 * 60 + 29.41) * 1000 + 60 * 1000,
			0,
		);
	});

	it("uses video stream frames when container duration is misleading", async () => {
		const { parseFfprobeVideoStreamDuration } = await import("./diagnostics");

		expect(
			parseFfprobeVideoStreamDuration(
				JSON.stringify({
					streams: [
						{
							duration: "18.000000",
							nb_read_frames: "540",
							avg_frame_rate: "30/1",
						},
					],
				}),
			),
		).toEqual({
			durationSeconds: 18,
			frameCount: 540,
			frameRate: 30,
		});
	});

	it("derives video stream duration from frame count when stream duration is absent", async () => {
		const { parseFfprobeVideoStreamDuration } = await import("./diagnostics");

		expect(
			parseFfprobeVideoStreamDuration(
				JSON.stringify({
					streams: [
						{
							nb_read_frames: "540",
							avg_frame_rate: "30/1",
						},
					],
				}),
			),
		).toEqual({
			durationSeconds: 18,
			frameCount: 540,
			frameRate: 30,
		});
	});

	it("writes a recording diagnostics sidecar with stream and audio probes", async () => {
		const videoPath = path.join(tempRoot, "recording-123.mp4");
		const micPath = path.join(tempRoot, "recording-123.mic.wav");
		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(micPath, "mic"),
			fs.writeFile(`${micPath}.json`, JSON.stringify({ startDelayMs: 125 })),
		]);

		execFileMock.mockImplementation(
			(
				file: string,
				args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => {
				if (file === "ffprobe" || args.includes("-of")) {
					callback(
						null,
						JSON.stringify({
							streams: [
								{
									codec_type: args.at(-1) === micPath ? "audio" : "video",
									duration: "18.000000",
									nb_read_frames: "540",
									avg_frame_rate: "30/1",
								},
							],
							format: { duration: "18.000000" },
						}),
						"",
					);
					return;
				}

				const error = new Error("ffmpeg probe") as Error & { stderr?: string };
				error.stderr = "Duration: 00:00:18.00, start: 0.000000";
				callback(error, "", error.stderr);
			},
		);

		const { getRecordingDiagnosticsPath, writeRecordingDiagnosticsSnapshot } = await import(
			"./diagnostics"
		);

		const diagnosticsPath = await writeRecordingDiagnosticsSnapshot(videoPath, {
			backend: "windows-wgc",
			phase: "mux-start",
			expectedDurationMs: 60_000,
			outputPath: videoPath,
			microphonePath: micPath,
			details: {
				hasMicrophone: true,
			},
		});
		const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, "utf8"));

		expect(diagnosticsPath).toBe(getRecordingDiagnosticsPath(videoPath));
		expect(diagnostics.events).toHaveLength(1);
		expect(diagnostics.latest.expectedDurationMs).toBe(60_000);
		expect(diagnostics.latest.media.video.stream).toEqual({
			durationSeconds: 18,
			frameCount: 540,
			frameRate: 30,
		});
		expect(diagnostics.latest.media.microphone).toMatchObject({
			path: micPath,
			exists: true,
			containerDurationSeconds: 18,
			startDelayMs: 125,
			audioStreamCount: 1,
			hasAudioStream: true,
		});
		expect(diagnostics.latest.media.video.hasAudioStream).toBe(false);
		// One structured header probe per existing media file supplies duration and streams.
		expect(execFileMock).toHaveBeenCalledTimes(2);
		expect(execFileMock.mock.calls.every(([file]) => file === "ffprobe")).toBe(true);
	});

	it("distinguishes confirmed audio, video-only media, and incomplete stream metadata", async () => {
		const { parseFfprobeRecordingMedia } = await import("./diagnostics");
		expect(
			parseFfprobeRecordingMedia(
				JSON.stringify({
					streams: [{ codec_type: "video" }, { codec_type: "audio" }],
					format: { duration: "12.5" },
				}),
			),
		).toMatchObject({
			hasAudioStream: true,
			audioStreamCount: 1,
			containerDurationSeconds: 12.5,
		});
		expect(
			parseFfprobeRecordingMedia(JSON.stringify({ streams: [{ codec_type: "video" }] })),
		).toMatchObject({ hasAudioStream: false, audioStreamCount: 0 });
		for (const incomplete of [{}, { streams: [] }, { streams: [{}] }]) {
			expect(parseFfprobeRecordingMedia(JSON.stringify(incomplete))).toMatchObject({
				hasAudioStream: null,
				audioStreamCount: null,
			});
		}
	});

	it("records unknown audio rather than no audio when a media probe fails", async () => {
		const videoPath = path.join(tempRoot, "unreadable.mp4");
		await fs.writeFile(videoPath, "video");
		execFileMock.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: Record<string, unknown>,
				callback: ExecFileCallback,
			) => callback(new Error("ffprobe failed"), "", ""),
		);
		const { writeRecordingDiagnosticsSnapshot } = await import("./diagnostics");
		const diagnosticsPath = await writeRecordingDiagnosticsSnapshot(videoPath, {
			backend: "windows-wgc",
			phase: "stop",
		});
		const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, "utf8"));
		expect(diagnostics.latest.media.video).toMatchObject({
			exists: true,
			containerDurationSeconds: null,
			hasAudioStream: null,
			audioStreamCount: null,
			stream: null,
		});
	});

	it.each([
		{ systemAudio: false, microphone: false },
		{ systemAudio: false, microphone: true },
		{ systemAudio: true, microphone: false },
		{ systemAudio: true, microphone: true },
	])("retains the original audio request across concurrent finalization events: %j", async (requestedAudio) => {
		const videoPath = path.join(tempRoot, "recording-request.mp4");
		const { writeRecordingDiagnosticsSnapshot } = await import("./diagnostics");
		const diagnosticsPath = await writeRecordingDiagnosticsSnapshot(videoPath, {
			backend: "windows-wgc",
			phase: "start",
			requestedAudio,
		});
		await Promise.all([
			writeRecordingDiagnosticsSnapshot(videoPath, {
				backend: "windows-wgc",
				phase: "mux-complete",
			}),
			writeRecordingDiagnosticsSnapshot(videoPath, {
				backend: "browser-store",
				phase: "mic-sidecar",
			}),
		]);
		const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, "utf8"));
		expect(diagnostics.requestedAudio).toEqual(requestedAudio);
		expect(diagnostics.events).toHaveLength(3);
		expect(diagnostics.events.map((event: { phase: string }) => event.phase)).toEqual([
			"start",
			"mux-complete",
			"mic-sidecar",
		]);
		expect(diagnostics.latest.requestedAudio).toEqual(requestedAudio);
		// Requested flags are independent of whether an output/sidecar was actually saved.
		expect(diagnostics.latest.media.video.exists).toBe(false);
	});

	it("ignores invalid sidecar timing metadata values", async () => {
		const micPath = path.join(tempRoot, "recording.mic.wav");
		await Promise.all([
			fs.writeFile(micPath, "mic"),
			fs.writeFile(`${micPath}.json`, JSON.stringify({ startDelayMs: -250 })),
		]);

		const { getCompanionAudioStartDelayMs } = await import("./diagnostics");

		await expect(getCompanionAudioStartDelayMs(micPath)).resolves.toBeNull();
	});

	it("classifies wall-clock mic chunk gaps covered by pause intervals", async () => {
		const { summarizeMicrophoneChunkTiming } = await import("./diagnostics");

		expect(
			summarizeMicrophoneChunkTiming(
				[
					{
						index: 0,
						size: 1024,
						elapsedMs: 250,
						deltaMs: null,
						recordedElapsedMs: 250,
						recordedDeltaMs: null,
					},
					{
						index: 1,
						size: 1024,
						elapsedMs: 8250,
						deltaMs: 8000,
						recordedElapsedMs: 500,
						recordedDeltaMs: 250,
					},
				],
				[{ startElapsedMs: 250, endElapsedMs: 8250, durationMs: 7750 }],
				250,
			),
		).toMatchObject({
			status: "pause-accounted",
			wallClockGapCount: 1,
			recordedGapCount: 0,
			pausedDurationMs: 7750,
		});
	});

	it("flags recorded mic chunk gaps that remain after pause accounting", async () => {
		const { summarizeMicrophoneChunkTiming } = await import("./diagnostics");

		expect(
			summarizeMicrophoneChunkTiming(
				[
					{
						index: 0,
						size: 1024,
						elapsedMs: 250,
						deltaMs: null,
						recordedElapsedMs: 250,
						recordedDeltaMs: null,
					},
					{
						index: 1,
						size: 1024,
						elapsedMs: 2500,
						deltaMs: 2250,
						recordedElapsedMs: 2500,
						recordedDeltaMs: 2250,
					},
				],
				[],
				250,
			),
		).toMatchObject({
			status: "needs-review",
			wallClockGapCount: 1,
			recordedGapCount: 1,
		});
	});

	it("rejects tiny MP4 container-only outputs before they reach the editor", async () => {
		const videoPath = path.join(tempRoot, "recording-123.mp4");
		await fs.writeFile(videoPath, Buffer.alloc(261));

		const { validateRecordedVideo } = await import("./diagnostics");

		await expect(validateRecordedVideo(videoPath)).rejects.toThrow(
			"Recorded output is too small to contain playable video",
		);
	});
});
