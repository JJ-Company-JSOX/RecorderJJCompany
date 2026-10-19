import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { CaptionAudioCandidate } from "./audioCandidates";
import { generateAutoCaptionsFromVideo } from "./generate";

const modelFile = "ggml-small-q5_1.bin";
const runtimeFile = "runtime/whisper-cli.exe";
type SpeechManifest = {
	version: 1;
	modelName: string;
	files: Array<{ path: string; bytes: number; sha256: string }>;
};

export function getBundledSpeechRoot() {
	return app.isPackaged
		? path.join(process.resourcesPath, "offline-ai", "speech")
		: path.join(app.getAppPath(), "vendor", "offline-ai", "win32-x64", "speech");
}

function within(root: string, file: string) {
	const relative = path.relative(root, file);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readManifest(root: string) {
	const canonicalRoot = await fs.realpath(root);
	const manifestPath = await fs.realpath(path.join(root, "manifest.json"));
	if (!within(canonicalRoot, manifestPath) || (await fs.stat(manifestPath)).size > 64_000)
		throw new Error("Invalid bundled speech manifest.");
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SpeechManifest;
	if (
		manifest.version !== 1 ||
		typeof manifest.modelName !== "string" ||
		!manifest.modelName.trim() ||
		!Array.isArray(manifest.files) ||
		manifest.files.length > 128 ||
		![modelFile, runtimeFile].every((name) =>
			manifest.files.some((entry) => entry.path === name),
		)
	)
		throw new Error("Invalid bundled speech manifest.");
	const seen = new Set<string>();
	const assets: Array<{ path: string; sha256: string }> = [];
	for (const entry of manifest.files) {
		if (
			typeof entry?.path !== "string" ||
			!/^(?:ggml-small-q5_1\.bin|MODEL-LICENSE\.txt|NOTICE\.txt|runtime\/[a-zA-Z0-9_.-]+)$/.test(
				entry.path,
			) ||
			entry.path.includes("..") ||
			seen.has(entry.path.toLowerCase()) ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes <= 0 ||
			typeof entry.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		)
			throw new Error("Invalid bundled speech asset.");
		seen.add(entry.path.toLowerCase());
		const canonicalPath = await fs.realpath(path.join(canonicalRoot, entry.path));
		const stat = await fs.stat(canonicalPath);
		if (!within(canonicalRoot, canonicalPath) || !stat.isFile() || stat.size !== entry.bytes)
			throw new Error(
				"Bundled speech assets are missing or corrupt. Reinstall the complete offline application.",
			);
		assets.push({ path: canonicalPath, sha256: entry.sha256 });
	}
	return { manifest, canonicalRoot, assets };
}

// Status performs only metadata checks; no model process or large hash scan on startup.
export async function getBundledSpeechStatus(root = getBundledSpeechRoot()) {
	const unavailable = {
		available: false,
		modelName: "Whisper small Q5_1 multilingual",
		modelPath: null,
		runtimePath: null,
	};
	if (process.platform !== "win32" || process.arch !== "x64")
		return { ...unavailable, reason: "unsupported" };
	try {
		const { manifest, canonicalRoot } = await readManifest(root);
		return {
			available: true,
			modelName: manifest.modelName,
			modelPath: path.join(canonicalRoot, modelFile),
			runtimePath: path.join(canonicalRoot, runtimeFile),
			reason: undefined,
		};
	} catch {
		return { ...unavailable, reason: "missing" };
	}
}

export async function verifyBundledSpeechAssets(
	root = getBundledSpeechRoot(),
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	const result = await readManifest(root);
	for (const asset of result.assets) {
		signal?.throwIfAborted();
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(asset.path, { signal })) hash.update(chunk);
		if (hash.digest("hex") !== asset.sha256)
			throw new Error(
				"Bundled speech integrity check failed. Reinstall the complete offline application.",
			);
	}
	signal?.throwIfAborted();
	return {
		modelPath: path.join(result.canonicalRoot, modelFile),
		runtimePath: path.join(result.canonicalRoot, runtimeFile),
		modelName: result.manifest.modelName,
	};
}

export async function generateBundledSpeechTranscript(options: {
	videoPath: string;
	language?: string;
	signal?: AbortSignal;
	// The caller approves every media path before dispatch. Supplied candidates
	// are reused verbatim; this function never expands that approved set.
	candidates?: CaptionAudioCandidate[];
}) {
	options.signal?.throwIfAborted();
	if (process.platform !== "win32" || process.arch !== "x64")
		throw new Error("Bundled offline speech is available on Windows x64 only.");
	const bundle = await verifyBundledSpeechAssets(getBundledSpeechRoot(), options.signal);
	return generateAutoCaptionsFromVideo({
		...options,
		useDtwAlignment: true,
		whisperExecutablePath: bundle.runtimePath,
		whisperModelPath: bundle.modelPath,
	});
}
