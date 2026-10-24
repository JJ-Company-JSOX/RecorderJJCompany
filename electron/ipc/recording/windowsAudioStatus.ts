import fs from "node:fs/promises";

/** Legacy helpers report stderr; newer helpers order the stdout marker before startup. */
export async function isWindowsSystemAudioUnavailable(
	captureOutput: string,
	requested: boolean,
	outputPath: string | null,
): Promise<boolean> {
	if (!requested) return false;
	if (/SYSTEM_AUDIO_CAPTURE_UNAVAILABLE|Failed to initialize WASAPI loopback/.test(captureOutput))
		return true;
	if (!outputPath) return true;
	try {
		// start() creates the WAV header synchronously before "Recording started".
		// Do not require packets yet: a quiet output device may not produce any.
		const stat = await fs.stat(outputPath);
		return !stat.isFile() || stat.size < 44;
	} catch (error) {
		// A sharing violation on a busy Windows file is not evidence that capture failed.
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR";
	}
}
