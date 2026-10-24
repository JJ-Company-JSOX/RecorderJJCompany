import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWindowsSystemAudioUnavailable } from "./windowsAudioStatus";

describe("Windows system audio startup status", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-audio-status-"));
	});
	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});
	it("does not report failure when system audio was deliberately disabled", async () => {
		expect(
			await isWindowsSystemAudioUnavailable("SYSTEM_AUDIO_CAPTURE_UNAVAILABLE", false, null),
		).toBe(false);
	});
	it.each([
		"SYSTEM_AUDIO_CAPTURE_UNAVAILABLE",
		"WARNING: Failed to initialize WASAPI loopback",
	])("reports %s even if a WAV header exists", async (marker) => {
		const file = path.join(directory, "system.wav");
		await fs.writeFile(file, Buffer.alloc(44));
		expect(
			await isWindowsSystemAudioUnavailable(`${marker}\nRecording started`, true, file),
		).toBe(true);
	});
	it("detects a missing output from legacy helpers without a status marker", async () => {
		expect(
			await isWindowsSystemAudioUnavailable(
				"Recording started",
				true,
				path.join(directory, "absent.wav"),
			),
		).toBe(true);
	});
	it("accepts an initial WAV header without treating a quiet device as failure", async () => {
		const file = path.join(directory, "system.wav");
		await fs.writeFile(file, Buffer.alloc(44));
		expect(await isWindowsSystemAudioUnavailable("Recording started", true, file)).toBe(false);
	});
	it("rejects a directory or incomplete header", async () => {
		expect(await isWindowsSystemAudioUnavailable("Recording started", true, directory)).toBe(
			true,
		);
		const file = path.join(directory, "empty.wav");
		await fs.writeFile(file, "");
		expect(await isWindowsSystemAudioUnavailable("Recording started", true, file)).toBe(true);
	});
});
