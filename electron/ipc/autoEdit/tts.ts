import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import {
	narrationMessages,
	narrationPreviewText,
} from "../../../src/components/video-editor/auto-edit/narrationMessages";
import {
	joinNarrationText,
	splitNarrationSentences,
} from "../../../src/components/video-editor/auto-edit/narrationText";
import { normalizeLoudness } from "./loudness";

export type VoiceLanguage = "zh" | "en" | "ms";
type SpokenLanguage = "zh" | "en";
const HAN = /\p{Script=Han}/u;
const LATIN = /[A-Za-z]/;

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

type BundleName = "kokoro" | "vits-zh" | "vits-en";
type Bundle = {
	engine: "kokoro" | "vits";
	directory: string;
	/** Every file the manifest must list. */
	files: string[];
	/** Folders whose files the manifest may list as well (espeak-ng-data holds hundreds). */
	folders?: string[];
	config: (root: string) => object;
};

/** Leaves a core for the editor; past four threads these models barely get faster. */
export const ttsThreads = (cores = os.availableParallelism()) =>
	Math.min(4, Math.max(2, cores - 1));

const inRoot = (root: string, names: string[]) =>
	names.map((name) => path.join(root, name)).join(",");

const vitsConfig = (root: string, ruleFsts?: string[]) => ({
	model: {
		vits: {
			model: path.join(root, "model.onnx"),
			lexicon: path.join(root, "lexicon.txt"),
			tokens: path.join(root, "tokens.txt"),
		},
		numThreads: ttsThreads(),
		provider: "cpu",
	},
	...(ruleFsts ? { ruleFsts: inRoot(root, ruleFsts) } : {}),
	maxNumSentences: 1,
});

const BUNDLES: Record<BundleName, Bundle> = {
	// One multilingual model: Mandarin, English, and English words inside Chinese lines.
	kokoro: {
		engine: "kokoro",
		directory: "tts-kokoro",
		files: [
			"model.onnx",
			"voices.bin",
			"tokens.txt",
			"lexicon-us-en.txt",
			"lexicon-zh.txt",
			"date-zh.fst",
			"phone-zh.fst",
			"number-zh.fst",
			// What sherpa-onnx needs before it loads; the rest of the folder is listed too.
			"espeak-ng-data/phontab",
			"espeak-ng-data/phonindex",
			"espeak-ng-data/phondata",
			"espeak-ng-data/intonations",
			"espeak-ng-data/en_dict",
			"MODEL-LICENSE.txt",
			"NOTICE.txt",
		],
		folders: ["espeak-ng-data"],
		config: (root) => ({
			model: {
				kokoro: {
					model: path.join(root, "model.onnx"),
					voices: path.join(root, "voices.bin"),
					tokens: path.join(root, "tokens.txt"),
					// English words missing from the lexicon are pronounced by espeak-ng.
					dataDir: path.join(root, "espeak-ng-data"),
					lexicon: inRoot(root, ["lexicon-us-en.txt", "lexicon-zh.txt"]),
					lengthScale: 1.0,
				},
				numThreads: ttsThreads(),
				provider: "cpu",
			},
			ruleFsts: inRoot(root, ["date-zh.fst", "phone-zh.fst", "number-zh.fst"]),
			maxNumSentences: 1,
			// sherpa-onnx's default 0.2 squeezes every pause longer than 0.2 s to a fifth.
			silenceScale: 1.0,
		}),
	},
	// Older single-language voices, kept for packages and developer folders without Kokoro.
	"vits-zh": {
		engine: "vits",
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
		config: (root) =>
			vitsConfig(root, ["date.fst", "phone.fst", "number.fst", "new_heteronym.fst"]),
	},
	"vits-en": {
		engine: "vits",
		directory: "tts-en",
		files: ["model.onnx", "lexicon.txt", "tokens.txt", "MODEL-LICENSE.txt", "NOTICE.txt"],
		config: (root) => vitsConfig(root),
	},
};

type VoiceName = keyof typeof narrationMessages.en.voices;
type Speaker = { id: number; name: VoiceName; gender: "female" | "male" };
type Voice = {
	bundle: BundleName;
	speaks: (text: string) => boolean;
	/** Rewrites what the voice reads (never the subtitle) into words it can say. */
	spoken?: (text: string) => string;
	wrongLanguage: string;
	/** Speakers a customer may choose, the default first. None: the model's speaker 0 only. */
	speakers: Speaker[];
};

/**
 * The voice for each language, preferred first. Kokoro speaker ids come from the speaker
 * table in the v1.0 model's own metadata.
 */
const VOICES: Record<SpokenLanguage, Voice[]> = {
	zh: [
		{
			bundle: "kokoro",
			// Its Chinese voices also say English words: on-screen labels can stay in English.
			speaks: (text) => HAN.test(text) || LATIN.test(text),
			wrongLanguage:
				"The bundled Chinese narration voice reads Chinese and English words only",
			// Default: the clearest of the four when its speech was transcribed back (Chinese
			// and mixed lines), and the only one that needs no peak limiting at -16 LUFS.
			speakers: [
				{ id: 48, name: "zf_xiaoyi", gender: "female" },
				{ id: 47, name: "zf_xiaoxiao", gender: "female" },
				{ id: 50, name: "zm_yunxi", gender: "male" },
				{ id: 49, name: "zm_yunjian", gender: "male" },
			],
		},
		{
			bundle: "vits-zh",
			speaks: (text) => HAN.test(text),
			wrongLanguage: "The bundled Chinese narration voice speaks Mandarin Chinese only",
			speakers: [],
		},
	],
	en: [
		{
			bundle: "kokoro",
			// Chinese characters would be read in a heavy accent, as with the older voice.
			speaks: (text) => LATIN.test(text) && !HAN.test(text),
			// Also keeps digits away from the Chinese number rules, which would read them in Chinese.
			spoken: spokenEnglish,
			wrongLanguage: "The bundled English narration voice reads English text only",
			// Default: the voice the model's author uses in every example.
			speakers: [
				{ id: 3, name: "af_heart", gender: "female" },
				{ id: 2, name: "af_bella", gender: "female" },
				{ id: 16, name: "am_michael", gender: "male" },
				{ id: 26, name: "bm_george", gender: "male" },
			],
		},
		{
			bundle: "vits-en",
			// The lexicon has no Chinese entries; such characters would be dropped silently.
			speaks: (text) => LATIN.test(text) && !HAN.test(text),
			spoken: spokenEnglish,
			wrongLanguage: "The bundled English narration voice reads English text only",
			speakers: [],
		},
	],
};
const voicesFor = (language: VoiceLanguage) => {
	const voices = VOICES[language as SpokenLanguage];
	if (!voices) throw new Error(`No bundled narration voice for language: ${language}`);
	return voices;
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

export function getBundledTtsRoot(bundle: BundleName = "vits-zh", base = bundledAiRoot()) {
	return path.join(base, BUNDLES[bundle].directory);
}

function within(root: string, file: string) {
	const relative = path.relative(root, file);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** One path part inside a listed folder: no "..", no leading or trailing dot or space. */
const SAFE_NAME = /^[A-Za-z0-9_!+-](?:[A-Za-z0-9_.!+ -]*[A-Za-z0-9_!+-])?$/;
const listed = (bundle: Bundle, file: string) => {
	if (bundle.files.includes(file)) return true;
	const parts = file.split("/");
	return (
		parts.length > 1 &&
		!!bundle.folders?.includes(parts[0]) &&
		parts.every((part) => SAFE_NAME.test(part))
	);
};

async function readManifest(root: string, bundle: Bundle) {
	const canonicalRoot = await fs.realpath(root);
	const manifestPath = await fs.realpath(path.join(root, "manifest.json"));
	const manifestStat = await fs.stat(manifestPath);
	if (!within(canonicalRoot, manifestPath) || manifestStat.size > 1_000_000)
		throw new Error("Invalid bundled narration voice manifest.");
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as TtsManifest;
	if (
		manifest.version !== 1 ||
		typeof manifest.modelName !== "string" ||
		!manifest.modelName.trim() ||
		!Array.isArray(manifest.files) ||
		manifest.files.length > 4096 ||
		!bundle.files.every((name) => manifest.files.some((entry) => entry?.path === name))
	)
		throw new Error("Invalid bundled narration voice manifest.");
	const seen = new Set<string>();
	const assets: Array<{ path: string; sha256: string; stamp: string }> = [];
	for (const entry of manifest.files) {
		if (
			typeof entry?.path !== "string" ||
			!listed(bundle, entry.path) ||
			seen.has(entry.path.toLowerCase()) ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes <= 0 ||
			typeof entry.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		)
			throw new Error("Invalid bundled narration voice asset.");
		seen.add(entry.path.toLowerCase());
		const canonicalPath = await fs.realpath(path.join(canonicalRoot, ...entry.path.split("/")));
		const stat = await fs.stat(canonicalPath);
		if (!within(canonicalRoot, canonicalPath) || !stat.isFile() || stat.size !== entry.bytes)
			throw new Error(
				"Bundled narration voice assets are missing or corrupt. Reinstall the complete offline application.",
			);
		assets.push({
			path: canonicalPath,
			sha256: entry.sha256,
			stamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
		});
	}
	// Changes whenever the manifest or any listed file is replaced or rewritten.
	const fingerprint = JSON.stringify([
		`${manifestStat.size}:${manifestStat.mtimeMs}`,
		...assets.map((asset) => [asset.path, asset.sha256, asset.stamp]),
	]);
	return { manifest, canonicalRoot, assets, fingerprint };
}

const isInstalled = (base: string, name: BundleName) =>
	readManifest(getBundledTtsRoot(name, base), BUNDLES[name]).then(
		() => true,
		() => false,
	);

export type BundledVoiceOption = {
	/** The speaker id synthesis takes. */
	id: number;
	language: SpokenLanguage;
	gender: "female" | "male";
	labels: Record<VoiceLanguage, string>;
	/** The voice used when none was chosen. */
	default: boolean;
};

// Status performs only metadata checks; no model load or large hash scan on startup.
export async function getBundledTtsStatus(base = bundledAiRoot()) {
	const voices: Record<VoiceLanguage, boolean> = { zh: false, en: false, ms: false };
	const voiceList: BundledVoiceOption[] = [];
	if (process.platform !== "win32" || process.arch !== "x64")
		return { available: false, voices, mixedLanguage: false, voiceList, reason: "unsupported" };
	const installed = new Set<BundleName>();
	for (const name of Object.keys(BUNDLES) as BundleName[])
		if (await isInstalled(base, name)) installed.add(name);
	let engine: Bundle["engine"] | undefined;
	let mixedLanguage = false;
	for (const language of ["zh", "en"] as const) {
		const voice = VOICES[language].find((candidate) => installed.has(candidate.bundle));
		if (!voice) continue;
		voices[language] = true;
		if (engine !== "kokoro") engine = BUNDLES[voice.bundle].engine;
		if (language === "zh") mixedLanguage = voice.bundle === "kokoro";
		voice.speakers.forEach((speaker, i) =>
			voiceList.push({
				id: speaker.id,
				language,
				gender: speaker.gender,
				labels: {
					zh: narrationMessages.zh.voices[speaker.name],
					en: narrationMessages.en.voices[speaker.name],
					ms: narrationMessages.ms.voices[speaker.name],
				},
				default: i === 0,
			}),
		);
	}
	const available = voices.zh || voices.en;
	return {
		available,
		voices,
		engine,
		mixedLanguage,
		voiceList,
		reason: available ? undefined : "missing",
	};
}

/** Bundles hashed in full this app session, with the fingerprint they had then. */
const verifiedBundles = new Map<string, string>();

export async function verifyBundledTtsAssets(
	root: string,
	signal?: AbortSignal,
	bundle: BundleName = "vits-zh",
) {
	signal?.throwIfAborted();
	const result = await readManifest(root, BUNDLES[bundle]);
	// Kokoro is about 400 MB: hash it once per session, and again only if a file changed.
	if (verifiedBundles.get(result.canonicalRoot) === result.fingerprint)
		return result.canonicalRoot;
	verifiedBundles.delete(result.canonicalRoot);
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
	verifiedBundles.set(result.canonicalRoot, result.fingerprint);
	return result.canonicalRoot;
}

/** Model output quieter than this, over 10 ms, counts as silence. */
const SILENCE_DB = -45;
const WINDOW_S = 0.01;
/** Kept before the first and after the last audible window, so soft onsets and tails stay. */
const LEAD_MARGIN_S = 0.025;
const TAIL_MARGIN_S = 0.05;
const FADE_S = 0.008;
/**
 * Kokoro reads a sentence in parts (at a switch between Chinese and English, or between
 * long clauses) and leaves about 1.1 s of silence between them. A comma pause in speech is
 * far shorter, so a longer pause inside a sentence is cut to this.
 */
const MAX_INNER_PAUSE_S = 0.26;
/** A pause at least this long inside a sentence is where a subtitle may change. */
const MIN_PAUSE_S = 0.08;
/** How far a subtitle change may move to land on such a pause. */
const SNAP_S = 0.35;
/**
 * The shortest time a subtitle chunk inside a sentence is shown (less only when the sentence
 * is too short to give every chunk this much), so a short one such as "好，" or "then," never
 * flashes by or gets no time at all and is dropped by the editor.
 */
const MIN_CHUNK_S = 0.25;

type Range = { start: number; end: number };

function fade(samples: Float32Array, at: number, length: number, direction: "in" | "out") {
	for (let i = 0; i < length; i++) {
		const index = direction === "in" ? at + i : at - 1 - i;
		if (index < 0 || index >= samples.length) break;
		samples[index] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / length);
	}
}

/**
 * Trims a sentence's leading and trailing silence (keeping a small margin), shortens
 * over-long pauses inside it and fades both ends so joins never click. Also returns the
 * pauses left inside it. Null when nothing in it is audible.
 */
export function shapeSentence(samples: Float32Array, sampleRate: number) {
	const window = Math.max(1, Math.round(WINDOW_S * sampleRate));
	const threshold = 10 ** (SILENCE_DB / 20);
	const loud: boolean[] = [];
	for (let start = 0; start < samples.length; start += window) {
		const end = Math.min(samples.length, start + window);
		let energy = 0;
		for (let i = start; i < end; i++) energy += samples[i] ** 2;
		loud.push(Math.sqrt(energy / (end - start)) >= threshold);
	}
	const first = loud.indexOf(true);
	if (first < 0) return null;
	const last = loud.lastIndexOf(true);
	const parts: Float32Array[] = [];
	const cuts: number[] = [];
	const pauses: Range[] = [];
	const half = Math.round((MAX_INNER_PAUSE_S / 2) * sampleRate);
	let cursor = Math.max(0, first * window - Math.round(LEAD_MARGIN_S * sampleRate));
	let written = 0;
	const copy = (end: number) => {
		parts.push(samples.subarray(cursor, end));
		written += end - cursor;
	};
	for (let w = first + 1; w < last; w++) {
		if (loud[w]) continue;
		let end = w;
		while (!loud[end]) end++;
		const gap = { start: w * window, end: end * window };
		w = end;
		if (gap.end - gap.start < MIN_PAUSE_S * sampleRate) continue;
		const at = written + gap.start - cursor;
		if (gap.end - gap.start <= 2 * half) {
			pauses.push({ start: at, end: at + gap.end - gap.start });
			continue;
		}
		copy(gap.start + half);
		cuts.push(written);
		cursor = gap.end - half;
		pauses.push({ start: at, end: at + 2 * half });
	}
	copy(Math.min(samples.length, (last + 1) * window + Math.round(TAIL_MARGIN_S * sampleRate)));
	const shaped = new Float32Array(written);
	let offset = 0;
	for (const part of parts) {
		shaped.set(part, offset);
		offset += part.length;
	}
	// The cut silence is faded to zero on both sides, so removing its middle cannot click.
	const cutFade = Math.round(0.004 * sampleRate);
	for (const at of cuts) {
		fade(shaped, at, cutFade, "out");
		fade(shaped, at, cutFade, "in");
	}
	const edge = Math.min(Math.round(FADE_S * sampleRate), Math.floor(shaped.length / 2));
	fade(shaped, 0, edge, "in");
	fade(shaped, shaped.length, edge, "out");
	return { samples: shaped, pauses };
}

/**
 * The pause after a sentence, by how it ends, varied a little by its position (the same
 * way every time) so the rhythm is not metronomic.
 */
export function sentencePauseS(text: string, index: number) {
	const base = /[？！?!]$/u.test(text) ? 0.36 : /[；;]$/u.test(text) ? 0.31 : 0.34;
	return Math.min(0.38, Math.max(0.3, base + [0, 0.02, -0.015, 0.01][index % 4]));
}

const CLAUSE_END = /[，,。.！!？?；;：:、]$/u;
/**
 * Latin-letter text inside a Chinese line (usually an on-screen label), with the quotes or
 * brackets around it and the punctuation after it.
 */
const LATIN_RUN =
	/[“"‘「『（(]*\p{Script=Latin}[\p{Script=Latin}\p{N}_'’.+&/-]*(?: +[\p{Script=Latin}\p{N}_'’.+&/-]+)*[”"’」』）)]*\s*[，,。.！!？?；;：:、]*/gu;

/**
 * Splits a sentence that mixes Chinese and English into the parts Kokoro says one by one.
 * sherpa-onnx reads the English through espeak-ng, and a short English word is glued straight
 * onto the Chinese syllables before it in one model call; the Chinese voices then garble it
 * (点击“Settings” was heard back as 点击赛). Said on its own and ended like a clause (a comma,
 * or a full stop at the end) it is understood far more often. Quotes, spaces and letter case
 * make no difference to what the model receives, so they are only tidied here. `pause` says
 * whether the text itself pauses after the part.
 */
export function mixedParts(text: string) {
	const parts: Array<{ spoken: string; latin: boolean; pause: boolean }> = [];
	const add = (piece: string, latin: boolean) => {
		if (!/[\p{L}\p{N}]/u.test(piece)) return;
		const spoken = latin
			? piece
					.replace(/[“”"「」『』（）()]/g, "")
					.replace(/[‘’]/g, "'")
					.trim()
			: piece.trim();
		parts.push({ spoken, latin, pause: CLAUSE_END.test(spoken) });
	};
	let last = 0;
	for (const match of text.matchAll(LATIN_RUN)) {
		add(text.slice(last, match.index), false);
		add(match[0], true);
		last = match.index + match[0].length;
	}
	add(text.slice(last), false);
	return parts.map(({ spoken, latin, pause }, i) => ({
		spoken: latin && !pause ? `${spoken}${i === parts.length - 1 ? "." : ","}` : spoken,
		pause,
	}));
}

/**
 * Silence put between the parts of a mixed sentence, on top of the margins each part keeps
 * (75 ms together): about 0.12 s where the text runs straight on, and the usual pause inside
 * a sentence where it has punctuation.
 */
const WORD_JOIN_S = 0.045;
const CLAUSE_JOIN_S = MAX_INNER_PAUSE_S - LEAD_MARGIN_S - TAIL_MARGIN_S;

const WIDE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** Roughly how long a piece takes to say: a Chinese character, or about three letters. */
function spokenWeight(text: string) {
	let weight = 0;
	for (const char of text)
		if (WIDE_CHAR.test(char) || /[，,、：:；;]/u.test(char)) weight += 1;
		else if (/[\p{L}\p{N}]/u.test(char)) weight += 0.35;
	return weight;
}

type SpokenSentence = {
	samples: Float32Array;
	pauses: Range[];
	chunks: string[];
	weights: number[];
	text: string;
};

/**
 * Where each subtitle chunk but the last ends inside its sentence: at its share of the
 * spoken characters, moved onto a pause when one is close. A pause can only move the
 * chunk end it is closest to, so the pause after a short next chunk ("then,", "好，") is
 * not taken for this one. Every chunk keeps at least MIN_CHUNK_S: a pause is used only
 * when it leaves that much for this chunk and each one after it, and ends are kept apart.
 */
export function chunkEnds(
	sentence: Pick<SpokenSentence, "samples" | "pauses" | "weights">,
	sampleRate: number,
) {
	const length = sentence.samples.length;
	const count = sentence.weights.length;
	const total = sentence.weights.reduce((sum, weight) => sum + weight, 0);
	let said = 0;
	const estimates = sentence.weights.slice(0, -1).map((weight, i) => {
		said += weight;
		return total ? (length * said) / total : (length * (i + 1)) / count;
	});
	const middle = (pause: Range) => (pause.start + pause.end) / 2;
	const closest = (pause: Range) =>
		estimates.reduce(
			(best, estimate, i) =>
				Math.abs(middle(pause) - estimate) < Math.abs(middle(pause) - estimates[best])
					? i
					: best,
			0,
		);
	const least = Math.min(MIN_CHUNK_S * sampleRate, length / count);
	const ends: number[] = [];
	let previous = 0;
	estimates.forEach((estimate, i) => {
		const earliest = previous + least;
		const latest = length - (count - 1 - i) * least;
		const nearest = sentence.pauses
			.filter((pause) => pause.end >= earliest && pause.end <= latest && closest(pause) === i)
			.map((pause) => ({ pause, distance: Math.abs(middle(pause) - estimate) }))
			.filter(({ distance }) => distance <= SNAP_S * sampleRate)
			.sort((a, b) => a.distance - b.distance)[0];
		const end = Math.round(
			Math.min(latest, Math.max(earliest, nearest?.pause.end ?? estimate)),
		);
		ends.push(end);
		previous = end;
	});
	return ends;
}

type Engine = {
	generateAsync(request: object): Promise<{ samples: Float32Array; sampleRate: number }>;
};

/**
 * Speaks one narration line a whole sentence at a time, so each sentence keeps its own
 * natural intonation instead of sounding like a list of fragments. Each sentence is trimmed
 * and faded, sentences are joined with punctuation-aware pauses, and the line is brought to
 * -16 LUFS with peaks under -1.5 dBFS. Subtitle chunks are timed inside their sentence.
 * With Kokoro, a sentence that mixes Chinese and English is said in parts (see mixedParts).
 * A sentence the voice cannot say (no word it knows) is shown with its neighbour instead of
 * failing the line; null when nothing at all was spoken.
 */
export async function speakLine(
	tts: Engine,
	line: string,
	options: {
		speakerId: number;
		spoken?: (text: string) => string;
		/** Kokoro takes its speaker, speed and pause settings as a generation config. */
		kokoro?: boolean;
		signal?: AbortSignal;
	},
) {
	const { speakerId, spoken, kokoro, signal } = options;
	/** Trimmed audio for one piece of text; null when the voice says nothing for it. */
	const say = async (text: string) => {
		signal?.throwIfAborted();
		const audio = await tts
			.generateAsync({
				text,
				sid: speakerId,
				speed: 1.0,
				// The addon's default hands back memory Electron's V8 sandbox refuses, and every
				// call then fails with "TTS settlement failed". Copy the samples instead.
				enableExternalBuffer: false,
				...(kokoro
					? { generationConfig: { sid: speakerId, speed: 1.0, silenceScale: 1.0 } }
					: {}),
			})
			.catch((error: unknown) => {
				if (error instanceof Error && error.message.includes("produced no audio"))
					return null;
				throw error;
			});
		const shaped = audio?.samples.length
			? shapeSentence(audio.samples, audio.sampleRate)
			: null;
		return audio && shaped ? { ...shaped, sampleRate: audio.sampleRate } : null;
	};
	const saySentence = async (text: string) => {
		if (!kokoro || !HAN.test(text) || !LATIN.test(text)) return say(text);
		const parts: Array<{ samples: Float32Array; sampleRate: number; pause: boolean }> = [];
		for (const part of mixedParts(text)) {
			const audio = await say(part.spoken);
			if (audio) parts.push({ ...audio, pause: part.pause });
		}
		if (!parts.length) return null;
		const rate = parts[0].sampleRate;
		const gaps = parts.map((part, i) =>
			i < parts.length - 1
				? Math.round((part.pause ? CLAUSE_JOIN_S : WORD_JOIN_S) * rate)
				: 0,
		);
		const joined = new Float32Array(
			parts.reduce((sum, part, i) => sum + part.samples.length + gaps[i], 0),
		);
		let at = 0;
		parts.forEach((part, i) => {
			joined.set(part.samples, at);
			at += part.samples.length + gaps[i];
		});
		// Trimmed and faded part by part already; this finds the pauses for the subtitles.
		const shaped = shapeSentence(joined, rate);
		return shaped ? { ...shaped, sampleRate: rate } : null;
	};
	const sentences: SpokenSentence[] = [];
	let sampleRate = 0;
	let unspoken = "";
	for (const sentence of splitNarrationSentences(line)) {
		const audio = await saySentence(spoken ? spoken(sentence.text) : sentence.text);
		if (!audio) {
			const last = sentences[sentences.length - 1];
			if (last)
				last.chunks[last.chunks.length - 1] = joinNarrationText(
					last.chunks[last.chunks.length - 1],
					sentence.text,
				);
			else unspoken = joinNarrationText(unspoken, sentence.text);
			continue;
		}
		sampleRate ||= audio.sampleRate;
		const chunks = [...sentence.chunks];
		chunks[0] = joinNarrationText(unspoken, chunks[0]);
		unspoken = "";
		sentences.push({
			samples: audio.samples,
			pauses: audio.pauses,
			chunks,
			weights: sentence.chunks.map(spokenWeight),
			text: sentence.text,
		});
	}
	if (!sentences.length) return null;
	const gaps = sentences.map((sentence, i) =>
		i < sentences.length - 1 ? Math.round(sentencePauseS(sentence.text, i) * sampleRate) : 0,
	);
	const total = sentences.reduce(
		(sum, sentence, i) => sum + sentence.samples.length + gaps[i],
		0,
	);
	const joined = new Float32Array(total);
	const chunks: Array<{ text: string; endMs: number }> = [];
	const ms = (samples: number) => Math.round((samples / sampleRate) * 1000);
	let offset = 0;
	sentences.forEach((sentence, i) => {
		joined.set(sentence.samples, offset);
		const ends = chunkEnds(sentence, sampleRate);
		// A chunk's time runs until the next one starts, so the last one includes the pause.
		sentence.chunks.forEach((text, j) =>
			chunks.push({
				text,
				endMs: ms(offset + (ends[j] ?? sentence.samples.length + gaps[i])),
			}),
		);
		offset += sentence.samples.length + gaps[i];
	});
	const normalized = normalizeLoudness(joined, sampleRate);
	return {
		samples: normalized.samples,
		sampleRate,
		durationMs: ms(total),
		chunks,
		loudness: {
			lufs: normalized.lufs,
			peakDb: normalized.peakDb,
			gainDb: normalized.gainDb,
			limitedDb: normalized.limitedDb,
		},
	};
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

/**
 * A voice folder sherpa-onnx can be given by full path: printable ASCII without a comma,
 * and short. espeak-ng, which Kokoro uses for English words its lexicon lacks, opens its
 * data folder with narrow file calls (read in the Windows ANSI code page) into a 230-byte
 * buffer, and when it cannot open it sherpa-onnx ends the whole process: an install under
 * C:\Users\张三\ would close the app on the first narration. sherpa-onnx also takes the
 * lexicons and rule files as one comma-separated list.
 */
const PLAIN_ROOT = /^[\x20-\x2b\x2d-\x7e]{1,100}$/;

let cachedEngine: { root: string; relative: boolean; tts: SherpaOnnx } | null = null;

/**
 * Loads a voice, from any other folder by names relative to it as the working directory.
 * espeak-ng keeps reading its data while it speaks, so the folder is entered again before
 * every use.
 */
async function loadEngine(root: string, bundle: Bundle) {
	const cached = cachedEngine?.root === root ? cachedEngine : null;
	const relative = cached ? cached.relative : !PLAIN_ROOT.test(root);
	if (relative)
		try {
			process.chdir(root);
		} catch {
			throw new Error(
				"The offline narration voice cannot load from this installation folder. Install the application in a folder with a shorter path.",
			);
		}
	if (cached) return cached.tts;
	const sherpaOnnx = await loadSherpa();
	const tts = await sherpaOnnx.OfflineTts.createAsync(bundle.config(relative ? "" : root));
	cachedEngine = { root, relative, tts };
	return tts;
}

/**
 * Picks the best installed voice for a language (Kokoro, else the older VITS voice),
 * checks the speaker against its curated list, then verifies and loads it.
 */
async function prepareVoice(
	language: VoiceLanguage,
	requestedSpeaker: unknown,
	signal?: AbortSignal,
) {
	const choices = voicesFor(language);
	const base = bundledAiRoot();
	let voice = choices[0];
	for (const candidate of choices)
		if (await isInstalled(base, candidate.bundle)) {
			voice = candidate;
			break;
		}
	const bundle = BUNDLES[voice.bundle];
	const speakerId = requestedSpeaker ?? voice.speakers[0]?.id ?? 0;
	if (
		!Number.isInteger(speakerId) ||
		(voice.speakers.length
			? !voice.speakers.some((speaker) => speaker.id === speakerId)
			: speakerId !== 0)
	)
		throw new Error("Invalid narration speaker");
	return {
		voice,
		speakerId: speakerId as number,
		load: async () => {
			const root = await verifyBundledTtsAssets(
				getBundledTtsRoot(voice.bundle, base),
				signal,
				voice.bundle,
			).catch((error: unknown) => {
				if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
					throw new Error(
						"The offline narration voice is not installed. Reinstall the complete offline application.",
					);
				throw error;
			});
			return loadEngine(root, bundle);
		},
	};
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
	for (const cue of cues) {
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(cue?.id)) throw new Error("Invalid narration cue id");
		if (typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > 500)
			throw new Error(`Invalid narration text for cue ${cue.id}`);
	}
	const { voice, speakerId, load } = await prepareVoice(language, options.speakerId, signal);
	for (const cue of cues)
		if (!voice.speaks(voice.spoken?.(cue.text) ?? cue.text))
			throw new Error(voice.wrongLanguage);
	const tts = await load();
	const sherpaOnnx = await loadSherpa();
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
		const line = await speakLine(tts, cue.text, {
			speakerId,
			spoken: voice.spoken,
			kokoro: voice.bundle === "kokoro",
			signal,
		});
		// Nothing in it the voice can say: left out, and the editor reports it.
		if (!line) continue;
		const audioPath = path.join(outputDirectory, `narration-${run}-${cue.id}.wav`);
		sherpaOnnx.writeWave(audioPath, { samples: line.samples, sampleRate: line.sampleRate });
		results.push({ id: cue.id, audioPath, durationMs: line.durationMs, chunks: line.chunks });
	}
	return results;
}

/** Says one short fixed sentence with the chosen voice, for the editor to play. */
export async function previewBundledVoice(options: {
	language: VoiceLanguage;
	speakerId?: number;
	signal?: AbortSignal;
}) {
	const { language, signal } = options;
	signal?.throwIfAborted();
	if (process.platform !== "win32" || process.arch !== "x64")
		throw new Error("Bundled offline narration voice is available on Windows x64 only.");
	const { voice, speakerId, load } = await prepareVoice(language, options.speakerId, signal);
	const line = await speakLine(await load(), narrationPreviewText[language as SpokenLanguage], {
		speakerId,
		spoken: voice.spoken,
		kokoro: voice.bundle === "kokoro",
		signal,
	});
	if (!line) throw new Error("Narration preview produced no audio");
	return { samples: line.samples, sampleRate: line.sampleRate, durationMs: line.durationMs };
}
