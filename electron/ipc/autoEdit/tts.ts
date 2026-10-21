import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { splitNarrationLine } from "../../../src/components/video-editor/auto-edit/narrationText";

export type VoiceLanguage = "zh" | "en" | "ms";
const HAN = /\p{Script=Han}/u;
type Voice = {
	directory: string;
	files: string[];
	numSpeakers: number;
	speaks: (text: string) => boolean;
	/** Rewrites what the voice reads (never the subtitle) into words its lexicon knows. */
	spoken?: (text: string) => string;
	wrongLanguage: string;
	config: (root: string) => object;
};

const ONES = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS: Record<string, string> = {
	one: "first",
	two: "second",
	three: "third",
	five: "fifth",
	eight: "eighth",
	nine: "ninth",
	twelve: "twelfth",
};

function numberWords(n: number): string {
	if (n < 20) return ONES[n];
	if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
	if (n < 1000)
		return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ""}`;
	const size = n >= 1e6 ? 1e6 : 1e3;
	const name = size === 1e6 ? "million" : "thousand";
	return `${numberWords(Math.floor(n / size))} ${name}${n % size ? ` ${numberWords(n % size)}` : ""}`;
}
const digitWords = (digits: string) => [...digits].map((d) => ONES[Number(d)]).join(" ");
const ordinal = (words: string) =>
	words.replace(
		/\w+$/,
		(last) => ORDINALS[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`),
	);

/**
 * The English voice's lexicon has no digits (it skips "5", and a piece that is only a
 * number makes no sound at all) and no curly apostrophes ("you’re"): say them as words.
 */
export function spokenEnglish(text: string) {
	return text
		.replace(/[‘’]/g, "'")
		.replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
		.replace(
			/(\d+)(?:\.(\d+))?(%|st\b|nd\b|rd\b|th\b)?/gi,
			(_, whole: string, fraction: string | undefined, suffix = "") => {
				const words =
					whole.length > 9 || (whole.length > 1 && whole.startsWith("0"))
						? digitWords(whole)
						: numberWords(Number(whole));
				const decimal = fraction ? ` point ${digitWords(fraction)}` : "";
				if (suffix === "%") return ` ${words}${decimal} percent `;
				return ` ${suffix && !fraction ? ordinal(words) : words + decimal} `;
			},
		)
		.replace(/\s+([,.!?;:])/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}
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
		spoken: spokenEnglish,
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

/** Short breath between subtitle chunks of one line. */
const CHUNK_PAUSE_S = 0.12;

const CJK_EDGE = /[\p{Script=Han}　-〿＀-￯]/u;
const joinText = (a: string, b: string) =>
	!a || !b ? a || b : CJK_EDGE.test(a[a.length - 1]) || CJK_EDGE.test(b[0]) ? a + b : `${a} ${b}`;

type Engine = {
	generateAsync(request: object): Promise<{ samples: Float32Array; sampleRate: number }>;
};

/**
 * Speaks one narration line, one engine call per subtitle chunk so each subtitle ends
 * exactly when its words do. A chunk the voice cannot say (no word it knows) is shown
 * with its neighbour instead of failing the line; null when nothing at all was spoken.
 */
export async function speakLine(
	tts: Engine,
	line: string,
	options: { speakerId: number; spoken?: (text: string) => string; signal?: AbortSignal },
) {
	const { speakerId, spoken, signal } = options;
	const parts: Float32Array[] = [];
	const chunks: Array<{ text: string; endMs: number }> = [];
	let sampleRate = 0;
	let total = 0;
	let unspoken = "";
	const ms = () => Math.round((total / sampleRate) * 1000);
	for (const text of splitNarrationLine(line)) {
		signal?.throwIfAborted();
		const audio = await tts
			.generateAsync({
				text: spoken ? spoken(text) : text,
				sid: speakerId,
				speed: 1.0,
				// The addon's default hands back memory Electron's V8 sandbox refuses, and every
				// call then fails with "TTS settlement failed". Copy the samples instead.
				enableExternalBuffer: false,
			})
			.catch((error: unknown) => {
				if (error instanceof Error && error.message.includes("produced no audio"))
					return null;
				throw error;
			});
		if (!audio?.samples.length) {
			const last = chunks[chunks.length - 1];
			if (last) last.text = joinText(last.text, text);
			else unspoken = joinText(unspoken, text);
			continue;
		}
		if (total) {
			const pause = new Float32Array(Math.round(sampleRate * CHUNK_PAUSE_S));
			parts.push(pause);
			total += pause.length;
			chunks[chunks.length - 1].endMs = ms();
		}
		sampleRate ||= audio.sampleRate;
		parts.push(audio.samples);
		total += audio.samples.length;
		chunks.push({ text: joinText(unspoken, text), endMs: ms() });
		unspoken = "";
	}
	if (!total) return null;
	const samples = new Float32Array(total);
	let offset = 0;
	for (const part of parts) {
		samples.set(part, offset);
		offset += part.length;
	}
	return { samples, sampleRate, durationMs: ms(), chunks };
}

// biome-ignore lint/suspicious/noExplicitAny: sherpa-onnx-node ships no type declarations.
type SherpaOnnx = any;

/**
 * sherpa-onnx-node is CommonJS. In the built app `import()` is native, and Node then exposes
 * its `module.exports` only as `default` (no named exports), so read it from there.
 */
export function sherpaExports(module: SherpaOnnx): SherpaOnnx {
	return module?.OfflineTts ? module : module?.default;
}
const loadSherpa = async (): Promise<SherpaOnnx> => sherpaExports(await import("sherpa-onnx-node"));

let cachedEngine: { root: string; tts: SherpaOnnx } | null = null;

async function loadEngine(root: string, voice: Voice) {
	if (cachedEngine?.root === root) return cachedEngine.tts;
	const sherpaOnnx = await loadSherpa();
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
		if (!voice.speaks(voice.spoken?.(cue.text) ?? cue.text))
			throw new Error(voice.wrongLanguage);
	}
	const root = await verifyBundledTtsAssets(getBundledTtsRoot(language), signal, language);
	const sherpaOnnx = await loadSherpa();
	const tts = await loadEngine(root, voice);
	// Earlier audio tracks keep pointing at their own files, so never reuse a name.
	const run = `${language}-${Date.now().toString(36)}`;
	await fs.mkdir(outputDirectory, { recursive: true });
	const results: Array<{
		id: string;
		audioPath: string;
		durationMs: number;
		chunks: Array<{ text: string; endMs: number }>;
	}> = [];
	for (const cue of cues) {
		const line = await speakLine(tts, cue.text, { speakerId, spoken: voice.spoken, signal });
		// Nothing in it the voice can say: left out, and the editor reports it.
		if (!line) continue;
		const audioPath = path.join(outputDirectory, `narration-${run}-${cue.id}.wav`);
		sherpaOnnx.writeWave(audioPath, { samples: line.samples, sampleRate: line.sampleRate });
		results.push({ id: cue.id, audioPath, durationMs: line.durationMs, chunks: line.chunks });
	}
	return results;
}
