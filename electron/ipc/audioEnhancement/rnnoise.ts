import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const REVISION = "70f1d256acd4b34a572f999a05c87bf00b67730d";
export interface VoiceEnhancementAsset {
	enabled: boolean;
	engine: "rnnoise";
	originalPath: string;
	audioPath: string;
	sampleRate: 48000;
	samples: number;
}

export async function getRnnoiseStatus(runtimeRoot: string) {
	try {
		const manifest = JSON.parse(
			await fs.readFile(path.join(runtimeRoot, "BUILD-INFO.json"), "utf8"),
		);
		if (manifest.sourceRevision !== REVISION || manifest.latencySamples !== 960)
			throw Error("Unsupported RNNoise build");
		for (const entry of manifest.files) {
			if (typeof entry.path !== "string" || path.basename(entry.path) !== entry.path)
				throw Error("Invalid RNNoise manifest");
			const data = await fs.readFile(path.join(runtimeRoot, entry.path));
			if (createHash("sha256").update(data).digest("hex") !== entry.sha256)
				throw Error("RNNoise asset integrity check failed");
		}
		if (!manifest.files.some((entry: { path: string }) => entry.path === "rnnoise-cli.exe"))
			throw Error("RNNoise runtime missing");
		return {
			available: true as const,
			engine: "rnnoise" as const,
			sampleRate: 48000,
			latencySamples: 960,
		};
	} catch (error) {
		return { available: false as const, message: String(error) };
	}
}

/** Caller must resolve approved source paths and own/abort the signal. No input is overwritten. */
export async function enhanceVoice(options: {
	sourcePath: string;
	outputDirectory: string;
	ffmpegPath: string;
	runtimeRoot: string;
	trackId?: "mic" | "mixed";
	signal?: AbortSignal;
}): Promise<VoiceEnhancementAsset> {
	options.signal?.throwIfAborted();
	const status = await getRnnoiseStatus(options.runtimeRoot);
	if (!status.available) throw Error(status.message);
	await fs.mkdir(options.outputDirectory, { recursive: true });
	const id = randomUUID();
	const work = await fs.mkdtemp(path.join(options.outputDirectory, ".rnnoise-"));
	const canonicalDirectory = await fs.realpath(options.outputDirectory);
	const canonicalWork = await fs.realpath(work);
	if (
		path.dirname(canonicalWork) !== canonicalDirectory ||
		!path.basename(canonicalWork).startsWith(".rnnoise-")
	)
		throw Error("Unexpected enhancement work directory");
	const raw = path.join(work, "input.s16le"),
		denoised = path.join(work, "enhanced.s16le");
	const output = path.join(
		options.outputDirectory,
		`${id}.${options.trackId ?? "mic"}.rnnoise.wav`,
	);
	let complete = false;
	const invoke = async (file: string, args: string[]) => {
		options.signal?.throwIfAborted();
		await run(file, args, {
			windowsHide: true,
			timeout: 30 * 60 * 1000,
			maxBuffer: 1024 * 1024,
			signal: options.signal,
		});
		options.signal?.throwIfAborted();
	};
	try {
		await invoke(options.ffmpegPath, [
			"-nostdin",
			"-v",
			"error",
			"-y",
			"-i",
			options.sourcePath,
			"-map",
			"0:a:0",
			"-vn",
			"-ar",
			"48000",
			"-ac",
			"1",
			"-c:a",
			"pcm_s16le",
			"-f",
			"s16le",
			raw,
		]);
		const input = await fs.stat(raw);
		if (input.size === 0 || input.size % 2) throw Error("No valid audio samples");
		// Limit unbounded CPU/disk tasks, matching offline AI's ten-minute preview scope.
		if (input.size > 48000 * 2 * 600)
			throw Error("Human voice enhancement currently supports recordings up to 10 minutes.");
		await invoke(path.join(options.runtimeRoot, "rnnoise-cli.exe"), [raw, denoised]);
		if ((await fs.stat(denoised)).size !== input.size)
			throw Error("RNNoise changed audio sample count");
		await invoke(options.ffmpegPath, [
			"-nostdin",
			"-v",
			"error",
			"-y",
			"-f",
			"s16le",
			"-ar",
			"48000",
			"-ac",
			"1",
			"-i",
			denoised,
			"-c:a",
			"pcm_s16le",
			output,
		]);
		complete = true;
		return {
			enabled: false,
			engine: "rnnoise",
			originalPath: options.sourcePath,
			audioPath: output,
			sampleRate: 48000,
			samples: input.size / 2,
		};
	} finally {
		// Recheck the resolved target before recursively removing our temporary files.
		if (
			(await fs.realpath(work).catch(() => null)) === canonicalWork &&
			path.dirname(canonicalWork) === canonicalDirectory
		)
			await fs.rm(canonicalWork, { recursive: true, force: true });
		if (!complete) await fs.rm(output, { force: true });
	}
}
