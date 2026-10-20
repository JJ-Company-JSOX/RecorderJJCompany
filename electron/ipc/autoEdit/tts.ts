import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

const MODEL_NAME = "AISHELL-3 VITS multi-speaker (sherpa-onnx)";
const NUM_SPEAKERS = 174;
const DEFAULT_SPEAKER_ID = 0;
const requiredFiles = [
	"model.onnx",
	"lexicon.txt",
	"tokens.txt",
	"speakers.txt",
	"date.fst",
	"phone.fst",
	"number.fst",
	"new_heteronym.fst",
	"MODEL-LICENSE.txt",
	"NOTICE.txt",
];

type TtsManifest = {
	version: 1;
	modelName: string;
	files: Array<{ path: string; bytes: number; sha256: string }>;
};

export function getBundledTtsRoot() {
	return app.isPackaged
		? path.join(process.resourcesPath, "offline-ai", "tts")
		: path.join(app.getAppPath(), "vendor", "offline-ai", "win32-x64", "tts");
}

function within(root: string, file: string) {
	const relative = path.relative(root, file);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readManifest(root: string) {
	const canonicalRoot = await fs.realpath(root);
	const manifestPath = await fs.realpath(path.join(root, "manifest.json"));
	if (!within(canonicalRoot, manifestPath) || (await fs.stat(manifestPath)).size > 64_000)
		throw new Error("Invalid bundled narration voice manifest.");
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as TtsManifest;
	if (
		manifest.version !== 1 ||
		typeof manifest.modelName !== "string" ||
		!manifest.modelName.trim() ||
		!Array.isArray(manifest.files) ||
		manifest.files.length > 32 ||
		!requiredFiles.every((name) => manifest.files.some((entry) => entry.path === name))
	)
		throw new Error("Invalid bundled narration voice manifest.");
	const seen = new Set<string>();
	const assets: Array<{ path: string; sha256: string }> = [];
	for (const entry of manifest.files) {
		if (
			typeof entry?.path !== "string" ||
			!requiredFiles.includes(entry.path) ||
			seen.has(entry.path.toLowerCase()) ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes <= 0 ||
			typeof entry.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		)
			throw new Error("Invalid bundled narration voice asset.");
		seen.add(entry.path.toLowerCase());
		const canonicalPath = await fs.realpath(path.join(canonicalRoot, entry.path));
		const stat = await fs.stat(canonicalPath);
		if (!within(canonicalRoot, canonicalPath) || !stat.isFile() || stat.size !== entry.bytes)
			throw new Error(
				"Bundled narration voice assets are missing or corrupt. Reinstall the complete offline application.",
			);
		assets.push({ path: canonicalPath, sha256: entry.sha256 });
	}
	return { manifest, canonicalRoot, assets };
}

// Status performs only metadata checks; no model load or large hash scan on startup.
export async function getBundledTtsStatus(root = getBundledTtsRoot()) {
	const unavailable = { available: false, modelName: MODEL_NAME, numSpeakers: NUM_SPEAKERS };
	if (process.platform !== "win32" || process.arch !== "x64")
		return { ...unavailable, reason: "unsupported" };
	try {
		const { manifest } = await readManifest(root);
		return {
			available: true,
			modelName: manifest.modelName,
			numSpeakers: NUM_SPEAKERS,
			reason: undefined,
		};
	} catch {
		return { ...unavailable, reason: "missing" };
	}
}

export async function verifyBundledTtsAssets(root: string, signal?: AbortSignal) {
	signal?.throwIfAborted();
	const result = await readManifest(root);
	for (const asset of result.assets) {
		signal?.throwIfAborted();
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(asset.path, { signal })) hash.update(chunk);
		if (hash.digest("hex") !== asset.sha256)
			throw new Error(
				"Bundled narration voice integrity check failed. Reinstall the complete offline application.",
			);
	}
	signal?.throwIfAborted();
	return result.canonicalRoot;
}

// biome-ignore lint/suspicious/noExplicitAny: sherpa-onnx-node ships no type declarations.
let cachedEngine: { root: string; tts: any } | null = null;

async function loadEngine(root: string) {
	if (cachedEngine?.root === root) return cachedEngine.tts;
	const sherpaOnnx = await import("sherpa-onnx-node");
	const tts = await sherpaOnnx.OfflineTts.createAsync({
		model: {
			vits: {
				model: path.join(root, "model.onnx"),
				lexicon: path.join(root, "lexicon.txt"),
				tokens: path.join(root, "tokens.txt"),
			},
			numThreads: 1,
			provider: "cpu",
		},
		ruleFsts: [
			path.join(root, "date.fst"),
			path.join(root, "phone.fst"),
			path.join(root, "number.fst"),
			path.join(root, "new_heteronym.fst"),
		].join(","),
		maxNumSentences: 1,
	});
	cachedEngine = { root, tts };
	return tts;
}

/**
 * Synthesizes the user-approved narration script into one WAV file per cue.
 * Input text is exactly what the user reviewed and approved in the editor.
 */
export async function synthesizeBundledNarration(options: {
	cues: Array<{ id: string; text: string }>;
	outputDirectory: string;
	speakerId?: number;
	signal?: AbortSignal;
}) {
	const { cues, outputDirectory, signal } = options;
	signal?.throwIfAborted();
	if (process.platform !== "win32" || process.arch !== "x64")
		throw new Error("Bundled offline narration voice is available on Windows x64 only.");
	if (!Array.isArray(cues) || !cues.length || cues.length > 200)
		throw new Error("Invalid narration cues");
	const speakerId = Number.isInteger(options.speakerId)
		? (options.speakerId as number)
		: DEFAULT_SPEAKER_ID;
	if (speakerId < 0 || speakerId >= NUM_SPEAKERS) throw new Error("Invalid narration speaker");
	for (const cue of cues) {
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(cue?.id)) throw new Error("Invalid narration cue id");
		if (typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > 500)
			throw new Error(`Invalid narration text for cue ${cue.id}`);
		if (!/\p{Script=Han}/u.test(cue.text))
			throw new Error("The bundled narration voice speaks Mandarin Chinese only");
	}
	const root = await verifyBundledTtsAssets(getBundledTtsRoot(), signal);
	const sherpaOnnx = await import("sherpa-onnx-node");
	const tts = await loadEngine(root);
	await fs.mkdir(outputDirectory, { recursive: true });
	const results: Array<{ id: string; audioPath: string; durationMs: number }> = [];
	for (const cue of cues) {
		signal?.throwIfAborted();
		const audio = await tts.generateAsync({ text: cue.text, sid: speakerId, speed: 1.0 });
		const audioPath = path.join(outputDirectory, `narration-${cue.id}.wav`);
		sherpaOnnx.writeWave(audioPath, { samples: audio.samples, sampleRate: audio.sampleRate });
		results.push({
			id: cue.id,
			audioPath,
			durationMs: Math.round((audio.samples.length / audio.sampleRate) * 1000),
		});
	}
	return results;
}
