import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, it, vi } from "vitest";
import ffmpeg from "ffmpeg-static";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
vi.mock("../ffmpeg/binary", async () => {
	const { default: ffprobe } = await import("ffprobe-static");
	return { getFfmpegBinaryPath: () => ffmpeg, getFfprobeBinaryPath: () => ffprobe.path };
});
vi.mock("../recording/diagnostics", () => ({
	getUsableCompanionAudioCandidates: async () => [],
	getCompanionAudioStartDelayMs: async () => null,
}));
vi.mock("../project/session", () => ({ resolveRecordingSession: async () => null }));
vi.mock("../utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));
import { extractCaptionAudioSource } from "./generate";
let directory: string;
beforeAll(async () => {
	await fs.mkdir(path.resolve(".tmp"), { recursive: true });
	directory = await fs.mkdtemp(path.resolve(".tmp/audio-extraction-real-"));
});
it("uses actual ffprobe JSON to distinguish a synthetic video without audio", async () => {
	if (!ffmpeg) throw Error("Bundled FFmpeg is required");
	const source = path.join(directory, "synthetic-silent.mp4");
	execFileSync(
		ffmpeg,
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			"color=size=160x90:rate=10:duration=0.3",
			"-an",
			"-c:v",
			"libx264",
			source,
		],
		{ stdio: "ignore", windowsHide: true, timeout: 15000 },
	);
	await expect(
		extractCaptionAudioSource({
			videoPath: source,
			ffmpegPath: ffmpeg,
			wavPath: path.join(directory, "output.wav"),
			candidates: [{ path: source, label: "recording" }],
		}),
	).rejects.toMatchObject({ code: "NO_AUDIO" });
}, 30000);
it("reports a real extraction output failure as extraction failed despite a valid audio stream", async () => {
	if (!ffmpeg) throw Error("Bundled FFmpeg is required");
	const source = path.join(directory, "synthetic-tone.wav");
	execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", source], {
		stdio: "ignore",
		windowsHide: true,
		timeout: 15000,
	});
	await expect(
		extractCaptionAudioSource({
			videoPath: source,
			ffmpegPath: ffmpeg,
			wavPath: path.join(directory, "nonexistent-folder/output.wav"),
			candidates: [{ path: source, label: "recording" }],
		}),
	).rejects.toMatchObject({
		code: "AUDIO_EXTRACTION_FAILED",
		attempts: [{ outcome: "extraction-failed" }],
	});
}, 30000);
