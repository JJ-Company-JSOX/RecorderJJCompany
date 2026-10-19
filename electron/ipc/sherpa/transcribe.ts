import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseSherpaCaptionResult, type SherpaCaption } from "./parser";

const run = promisify(execFile);
export async function getSherpaStatus(root: string) {
	try {
		for (const name of ["manifest.json", "model-manifest.json"]) {
			const manifest = JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
			if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length)
				throw Error("Missing Sherpa bundle");
			for (const entry of manifest.files) {
				if (
					!/^(runtime|models)\/[A-Za-z0-9_.-]+$/.test(entry.path) ||
					entry.path.includes("..")
				)
					throw Error("Invalid Sherpa asset");
				if ((await fs.stat(path.join(root, entry.path))).size !== entry.bytes)
					throw Error("Missing Sherpa asset");
			}
		}
		return { available: true, engine: "sherpa-onnx", model: "Whisper base INT8" };
	} catch {
		return { available: false, engine: "sherpa-onnx", model: "Whisper base INT8" };
	}
}

async function verify(root: string, signal: AbortSignal) {
	const canonical = await fs.realpath(root);
	for (const name of ["manifest.json", "model-manifest.json"]) {
		const manifest = JSON.parse(await fs.readFile(path.join(canonical, name), "utf8"));
		if (
			manifest.version !== 1 ||
			!Array.isArray(manifest.files) ||
			!manifest.files.length ||
			manifest.files.length > 128
		)
			throw Error("Invalid Sherpa bundle");
		for (const entry of manifest.files) {
			signal.throwIfAborted();
			if (
				!/^(runtime|models)\/[A-Za-z0-9_.-]+$/.test(entry.path) ||
				entry.path.includes("..") ||
				!/^[a-f0-9]{64}$/.test(entry.sha256)
			)
				throw Error("Invalid Sherpa asset");
			const file = await fs.realpath(path.join(canonical, entry.path));
			const relative = path.relative(canonical, file);
			if (
				relative.startsWith("..") ||
				path.isAbsolute(relative) ||
				(await fs.stat(file)).size !== entry.bytes
			)
				throw Error("Corrupt Sherpa asset");
			const hash = createHash("sha256");
			for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
			if (hash.digest("hex") !== entry.sha256) throw Error("Sherpa checksum mismatch");
		}
	}
}

/** Input is the caller's approved, delay-corrected 16k mono PCM WAV. */
export async function transcribeSherpa(options: {
	root: string;
	wavPath: string;
	ffmpegPath: string;
	ffprobePath: string;
	language: string;
	signal: AbortSignal;
}) {
	const { root, signal } = options;
	if (!/^(auto|en|zh|ms)$/.test(options.language))
		throw Error("Unsupported recognition language");
	await verify(root, signal);
	const { stdout } = await run(
		options.ffprobePath,
		["-v", "error", "-show_entries", "format=duration", "-of", "json", options.wavPath],
		{ windowsHide: true, signal, timeout: 30000 },
	);
	const durationMs = Math.round(Number(JSON.parse(stdout).format?.duration) * 1000);
	if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 600000)
		throw Error("Sherpa supports audio up to ten minutes");
	const base = await fs.realpath(os.tmpdir());
	const work = await fs.mkdtemp(path.join(base, "jsox-sherpa-"));
	const canonical = await fs.realpath(work);
	if (path.dirname(canonical) !== base) throw Error("Unexpected recognition work directory");
	const cues: SherpaCaption[] = [],
		started = performance.now();
	try {
		for (let startMs = 0; startMs < durationMs; startMs += 30000) {
			signal.throwIfAborted();
			const length = Math.min(30000, durationMs - startMs),
				wav = path.join(work, "chunk.wav");
			await run(
				options.ffmpegPath,
				[
					"-nostdin",
					"-v",
					"error",
					"-y",
					"-ss",
					String(startMs / 1000),
					"-i",
					options.wavPath,
					"-t",
					String(length / 1000),
					"-ar",
					"16000",
					"-ac",
					"1",
					"-c:a",
					"pcm_s16le",
					wav,
				],
				{ windowsHide: true, signal, timeout: 60000 },
			);
			const { stdout: result } = await run(
				path.join(root, "runtime/jsox-sherpa-asr.exe"),
				[
					path.join(root, "runtime/sherpa-onnx-c-api.dll"),
					path.join(root, "models/base-encoder.int8.onnx"),
					path.join(root, "models/base-decoder.int8.onnx"),
					path.join(root, "models/base-tokens.txt"),
					wav,
					options.language === "auto" ? "" : options.language,
					"4",
				],
				{ windowsHide: true, signal, timeout: 5 * 60000, maxBuffer: 2 * 1024 * 1024 },
			);
			cues.push(...parseSherpaCaptionResult(result, startMs, length));
		}
		return {
			engine: "sherpa-onnx" as const,
			model: "Whisper base INT8",
			durationMs,
			elapsedMs: Math.round(performance.now() - started),
			cues,
			warning:
				"Comparison transcript only. Chunk boundaries and model timestamps must not be used to approve automatic cuts.",
		};
	} finally {
		if (
			path.dirname(canonical) === base &&
			(await fs.realpath(work).catch(() => null)) === canonical
		)
			await fs.rm(canonical, { recursive: true, force: true });
	}
}
