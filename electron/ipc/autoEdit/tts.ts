import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export type VoiceLanguage = "zh" | "en" | "ms";
const HAN = /\p{Script=Han}/u;
type Voice = {
	directory: string;
	files: string[];
	numSpeakers: number;
	speaks: (text: string) => boolean;
	wrongLanguage: string;
	config: (root: string) => object;
};
const VOICES: Partial<Record<VoiceLanguage, Voice>> = {
	zh: {
		directory: "tts",
		files: [
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
		],
		numSpeakers: 174,
		speaks: (text) => HAN.test(text),
		wrongLanguage: "The bundled Chinese narration voice speaks Mandarin Chinese only",
		config: (root) => ({
			model: {
				vits: {
					model: path.join(root, "model.onnx"),
					lexicon: path.join(root, "lexicon.txt"),
					tokens: path.join(root, "tokens.txt"),
				},
				numThreads: 1,
				provider: "cpu",
			},
			ruleFsts: ["date.fst", "phone.fst", "number.fst", "new_heteronym.fst"]
				.map((name) => path.join(root, name))
				.join(","),
			maxNumSentences: 1,
		}),
	},
	en: {
		directory: "tts-en",
		files: ["model.onnx", "lexicon.txt", "tokens.txt", "MODEL-LICENSE.txt", "NOTICE.txt"],
		numSpeakers: 1,
		// The lexicon has no Chinese entries; such characters would be dropped silently.
		speaks: (text) => /[A-Za-z]/.test(text) && !HAN.test(text),
		wrongLanguage: "The bundled English narration voice reads English text only",
		config: (root) => ({
			model: {
				vits: {
					model: path.join(root, "model.onnx"),
					lexicon: path.join(root, "lexicon.txt"),
					tokens: path.join(root, "tokens.txt"),
				},
				numThreads: 1,
				provider: "cpu",
			},
			maxNumSentences: 1,
		}),
	},
};
const voiceFor = (language: VoiceLanguage) => {
	const voice = VOICES[language];
	if (!voice) throw new Error(`No bundled narration voice for language: ${language}`);
	return voice;
};

type TtsManifest = {
	version: 1;
	modelName: string;
	files: Array<{ path: string; bytes: number; sha256: string }>;
};

function bundledAiRoot() {
	return app.isPackaged
		? path.join(process.resourcesPath, "offline-ai")
		: path.join(app.getAppPath(), "vendor", "offline-ai", "win32-x64");
}

export function getBundledTtsRoot(language: VoiceLanguage = "zh") {
	return path.join(bundledAiRoot(), voiceFor(language).directory);
}

function within(root: string, file: string) {
	const relative = path.relative(root, file);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readManifest(root: string, requiredFiles: string[]) {
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
export async function getBundledTtsStatus(base = bundledAiRoot()) {
	const voices: Record<VoiceLanguage, boolean> = { zh: false, en: false, ms: false };
	if (process.platform !== "win32" || process.arch !== "x64")
		return { available: false, voices, reason: "unsupported" };
	for (const [language, voice] of Object.entries(VOICES) as Array<[VoiceLanguage, Voice]>)
		voices[language] = await readManifest(path.join(base, voice.directory), voice.files).then(
			() => true,
			() => false,
		);
	const available = Object.values(voices).some(Boolean);
	return { available, voices, reason: available ? undefined : "missing" };
}

export async function verifyBundledTtsAssets(
	root: string,
	signal?: AbortSignal,
	language: VoiceLanguage = "zh",
) {
	signal?.throwIfAborted();
	const result = await readManifest(root, voiceFor(language).files);
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

async function loadEngine(root: string, voice: Voice) {
	if (cachedEngine?.root === root) return cachedEngine.tts;
	const sherpaOnnx = await import("sherpa-onnx-node");
	const tts = await sherpaOnnx.OfflineTts.createAsync(voice.config(root));
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
	language?: VoiceLanguage;
	speakerId?: number;
	signal?: AbortSignal;
}) {
	const { cues, outputDirectory, signal } = options;
	const language = options.language ?? "zh";
	signal?.throwIfAborted();
	if (process.platform !== "win32" || process.arch !== "x64")
		throw new Error("Bundled offline narration voice is available on Windows x64 only.");
	if (!Array.isArray(cues) || !cues.length || cues.length > 200)
		throw new Error("Invalid narration cues");
	const voice = voiceFor(language);
	const speakerId = Number.isInteger(options.speakerId) ? (options.speakerId as number) : 0;
	if (speakerId < 0 || speakerId >= voice.numSpeakers)
		throw new Error("Invalid narration speaker");
	for (const cue of cues) {
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(cue?.id)) throw new Error("Invalid narration cue id");
		if (typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > 500)
			throw new Error(`Invalid narration text for cue ${cue.id}`);
		if (!voice.speaks(cue.text)) throw new Error(voice.wrongLanguage);
	}
	const root = await verifyBundledTtsAssets(getBundledTtsRoot(language), signal, language);
	const sherpaOnnx = await import("sherpa-onnx-node");
	const tts = await loadEngine(root, voice);
	// Earlier audio tracks keep pointing at their own files, so never reuse a name.
	const run = `${language}-${Date.now().toString(36)}`;
	await fs.mkdir(outputDirectory, { recursive: true });
	const results: Array<{ id: string; audioPath: string; durationMs: number }> = [];
	for (const cue of cues) {
		signal?.throwIfAborted();
		const audio = await tts.generateAsync({ text: cue.text, sid: speakerId, speed: 1.0 });
		const audioPath = path.join(outputDirectory, `narration-${run}-${cue.id}.wav`);
		sherpaOnnx.writeWave(audioPath, { samples: audio.samples, sampleRate: audio.sampleRate });
		results.push({
			id: cue.id,
			audioPath,
			durationMs: Math.round((audio.samples.length / audio.sampleRate) * 1000),
		});
	}
	return results;
}
