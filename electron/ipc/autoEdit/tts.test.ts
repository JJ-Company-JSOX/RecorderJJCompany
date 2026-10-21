import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { integratedLoudness, samplePeak, toDb } from "./loudness";

const mocks = vi.hoisted(() => ({
	appPath: "",
	createAsync: vi.fn(),
	generateAsync: vi.fn(),
	writeWave: vi.fn(),
}));
vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => mocks.appPath } }));
vi.mock("sherpa-onnx-node", () => ({
	OfflineTts: { createAsync: mocks.createAsync },
	writeWave: mocks.writeWave,
}));
// Counts how many files are read, to show the bundle is hashed once per session.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, default: actual, createReadStream: vi.fn(actual.createReadStream) };
});
import {
	getBundledTtsRoot,
	getBundledTtsStatus,
	previewBundledVoice,
	sentencePauseS,
	shapeSentence,
	sherpaExports,
	speakLine,
	spokenEnglish,
	synthesizeBundledNarration,
	ttsThreads,
	verifyBundledTtsAssets,
} from "./tts";

const VITS_ZH = [
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
const VITS_EN = ["model.onnx", "lexicon.txt", "tokens.txt", "MODEL-LICENSE.txt", "NOTICE.txt"];
const KOKORO = [
	"model.onnx",
	"voices.bin",
	"tokens.txt",
	"lexicon-us-en.txt",
	"lexicon-zh.txt",
	"date-zh.fst",
	"phone-zh.fst",
	"number-zh.fst",
	"MODEL-LICENSE.txt",
	"NOTICE.txt",
	"espeak-ng-data/phontab",
	"espeak-ng-data/phonindex",
	"espeak-ng-data/phondata",
	"espeak-ng-data/intonations",
	"espeak-ng-data/en_dict",
	"espeak-ng-data/lang/gmw/en-US",
	// Real espeak-ng-data names include "!" and spaces.
	"espeak-ng-data/voices/!v/Mr serious",
	// Hundreds of files, far past the old 32-entry manifest limit.
	...Array.from({ length: 340 }, (_, i) => `espeak-ng-data/lang/test/l${i}`),
];

const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
const arch = Object.getOwnPropertyDescriptor(process, "arch") as PropertyDescriptor;
/** The voice only runs on Windows x64; its logic is tested here on any machine. */
function asWindows() {
	Object.defineProperty(process, "platform", { ...platform, value: "win32" });
	Object.defineProperty(process, "arch", { ...arch, value: "x64" });
}

const temporary: string[] = [];
afterEach(async () => {
	Object.defineProperty(process, "platform", platform);
	Object.defineProperty(process, "arch", arch);
	for (const directory of temporary.splice(0)) {
		if (
			path.dirname(directory) !== os.tmpdir() ||
			!path.basename(directory).startsWith("jsox-tts-test-")
		)
			throw new Error("Unsafe test cleanup");
		await fs.rm(directory, { recursive: true, force: true });
	}
	vi.clearAllMocks();
});

async function fixture(directory = "tts", names = VITS_ZH, existingBase?: string) {
	const base = existingBase ?? (await fs.mkdtemp(path.join(os.tmpdir(), "jsox-tts-test-")));
	if (!existingBase) temporary.push(base);
	mocks.appPath = base;
	const root = path.join(base, "vendor", "offline-ai", "win32-x64", directory);
	const files = [];
	for (const name of names) {
		const text = `${name}-data`;
		await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
		await fs.writeFile(path.join(root, name), text);
		files.push({
			path: name,
			bytes: Buffer.byteLength(text),
			sha256: createHash("sha256").update(text).digest("hex"),
		});
	}
	const manifest = { version: 1, modelName: `Test ${directory} voice`, files };
	await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	return { base, root, manifest };
}

/** Like a voice model: some silence, a tone, more silence. */
function tone(seconds: number, sampleRate = 8000, lead = 0.2, tail = 0.3, amplitude = 0.2) {
	const samples = new Float32Array(Math.round((lead + seconds + tail) * sampleRate));
	const from = Math.round(lead * sampleRate);
	for (let i = 0; i < Math.round(seconds * sampleRate); i++)
		samples[from + i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
	return samples;
}
const concat = (...parts: Float32Array[]) => {
	const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};
const speaking = () =>
	mocks.generateAsync.mockImplementation(async () => ({ samples: tone(1), sampleRate: 8000 }));

describe("bundled narration voice assets", () => {
	it("resolves the dev vendor root from the app path", async () => {
		mocks.appPath = "/app";
		expect(getBundledTtsRoot()).toBe(
			path.join("/app", "vendor", "offline-ai", "win32-x64", "tts"),
		);
		expect(getBundledTtsRoot("kokoro")).toBe(
			path.join("/app", "vendor", "offline-ai", "win32-x64", "tts-kokoro"),
		);
	});
	it("verifies the exact bundled voice assets and detects same-size corruption", async () => {
		const { root } = await fixture();
		expect(await verifyBundledTtsAssets(root)).toBe(await fs.realpath(root));
		const corrupted = "model.onnx-data".replace("data", "evil");
		await fs.writeFile(path.join(root, "model.onnx"), corrupted);
		await expect(verifyBundledTtsAssets(root)).rejects.toThrow("integrity check failed");
	});
	it("verifies a Kokoro bundle whose espeak-ng-data folder has hundreds of files", async () => {
		const { root, manifest } = await fixture("tts-kokoro", KOKORO);
		expect(manifest.files.length).toBeGreaterThan(300);
		expect(await verifyBundledTtsAssets(root, undefined, "kokoro")).toBe(
			await fs.realpath(root),
		);
		// Only files inside the listed folder, and never a way out of it.
		for (const unsafe of ["espeak-ng-data/../model.onnx", "other/file", "espeak-ng-data/ x"]) {
			const changed = {
				...manifest,
				files: [...manifest.files, { ...manifest.files[0], path: unsafe }],
			};
			await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(changed));
			await expect(verifyBundledTtsAssets(root, undefined, "kokoro")).rejects.toThrow(
				"Invalid bundled narration voice asset",
			);
		}
		// A file sherpa-onnx needs before it loads cannot be left out.
		const missing = {
			...manifest,
			files: manifest.files.filter((file) => file.path !== "espeak-ng-data/phondata"),
		};
		await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(missing));
		await expect(verifyBundledTtsAssets(root, undefined, "kokoro")).rejects.toThrow(
			"Invalid bundled narration voice manifest",
		);
	});
	it("hashes the bundle once per app session, and again only after a file changes", async () => {
		const { root } = await fixture("tts-kokoro", KOKORO);
		const reads = () => vi.mocked(createReadStream).mock.calls.length;
		await verifyBundledTtsAssets(root, undefined, "kokoro");
		expect(reads()).toBe(KOKORO.length);
		await verifyBundledTtsAssets(root, undefined, "kokoro");
		await verifyBundledTtsAssets(root, undefined, "kokoro");
		expect(reads()).toBe(KOKORO.length);
		await fs.writeFile(path.join(root, "voices.bin"), "voices.bin-evil");
		await expect(verifyBundledTtsAssets(root, undefined, "kokoro")).rejects.toThrow(
			"integrity check failed",
		);
	});
	it("rejects manifest traversal and a missing asset", async () => {
		const { root, manifest } = await fixture();
		manifest.files.push({ ...manifest.files[0], path: "../outside.onnx" });
		await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await expect(verifyBundledTtsAssets(root)).rejects.toThrow(
			"Invalid bundled narration voice asset",
		);
		manifest.files.pop();
		await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await fs.rm(path.join(root, "model.onnx"));
		await expect(verifyBundledTtsAssets(root)).rejects.toThrow();
		asWindows();
		expect((await getBundledTtsStatus(path.dirname(root))).available).toBe(false);
	});
	it("stops before scanning or synthesizing when cancelled", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			verifyBundledTtsAssets("does-not-exist", controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "Hello" }],
				outputDirectory: "/tmp/out",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.createAsync).not.toHaveBeenCalled();
	});
});

describe("bundled narration voice status", () => {
	it("is unsupported off Windows x64", async () => {
		Object.defineProperty(process, "platform", { ...platform, value: "linux" });
		const { root } = await fixture();
		expect(await getBundledTtsStatus(path.dirname(root))).toEqual({
			available: false,
			voices: { zh: false, en: false, ms: false },
			mixedLanguage: false,
			voiceList: [],
			reason: "unsupported",
		});
	});
	it("reports the older voices from their manifests only, with no model load", async () => {
		asWindows();
		const { base, root } = await fixture();
		const status = await getBundledTtsStatus(path.dirname(root));
		expect(status).toMatchObject({
			available: true,
			voices: { zh: true, en: false, ms: false },
			engine: "vits",
			mixedLanguage: false,
			voiceList: [],
		});
		await fixture("tts-en", VITS_EN, base);
		expect(await getBundledTtsStatus(path.dirname(root))).toMatchObject({
			voices: { zh: true, en: true, ms: false },
			engine: "vits",
			mixedLanguage: false,
		});
		expect(mocks.createAsync).not.toHaveBeenCalled();
		expect(createReadStream).not.toHaveBeenCalled();
	});
	it("prefers Kokoro and lists two female and two male voices per language", async () => {
		asWindows();
		const { base, root } = await fixture();
		await fixture("tts-kokoro", KOKORO, base);
		const status = await getBundledTtsStatus(path.dirname(root));
		expect(status).toMatchObject({
			available: true,
			voices: { zh: true, en: true, ms: false },
			engine: "kokoro",
			mixedLanguage: true,
		});
		for (const language of ["zh", "en"] as const) {
			const voices = status.voiceList.filter((voice) => voice.language === language);
			expect(voices.map((voice) => voice.gender).sort()).toEqual([
				"female",
				"female",
				"male",
				"male",
			]);
			expect(voices.filter((voice) => voice.default)).toHaveLength(1);
			for (const voice of voices)
				expect(Object.values(voice.labels).every((label) => label.length > 0)).toBe(true);
		}
		expect(status.voiceList.find((voice) => voice.id === 47)?.labels.zh).toBe("晓晓（女声）");
		expect(status.voiceList.filter((voice) => voice.default).map((voice) => voice.id)).toEqual([
			48, 3,
		]);
		expect(mocks.createAsync).not.toHaveBeenCalled();
	});
});

describe("synthesizing narration", () => {
	it("rejects empty cues, an invalid cue id, an unknown speaker and the wrong language", async () => {
		await expect(
			synthesizeBundledNarration({ cues: [], outputDirectory: "/tmp/out" }),
		).rejects.toThrow();
		asWindows();
		const { root } = await fixture();
		mocks.createAsync.mockResolvedValue({ generateAsync: mocks.generateAsync });
		const out = path.join(root, "out");
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "../escape", text: "Hello" }],
				outputDirectory: out,
			}),
		).rejects.toThrow("Invalid narration cue id");
		// The older voice has one speaker, and Kokoro's ids are not valid for it.
		for (const speakerId of [999, 47])
			await expect(
				synthesizeBundledNarration({
					cues: [{ id: "suggestion-1", text: "这里点击按钮。" }],
					outputDirectory: out,
					speakerId,
				}),
			).rejects.toThrow("Invalid narration speaker");
		await expect(
			synthesizeBundledNarration({
				cues: [
					{ id: "suggestion-1", text: "这里点击按钮。" },
					{ id: "suggestion-2", text: "The presenter zooms in." },
				],
				outputDirectory: out,
			}),
		).rejects.toThrow("Mandarin Chinese only");
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "这里点击按钮。" }],
				outputDirectory: out,
				language: "en",
			}),
		).rejects.toThrow("English text only");
		// No English voice is installed in this folder.
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "Zoom in on the button." }],
				outputDirectory: out,
				language: "en",
			}),
		).rejects.toThrow("not installed");
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "Zoom in on the button." }],
				outputDirectory: out,
				language: "ms",
			}),
		).rejects.toThrow("No bundled narration voice");
		expect(mocks.createAsync).not.toHaveBeenCalled();
	});
	it("falls back to the older voice, one verified-path WAV per cue", async () => {
		asWindows();
		const { root } = await fixture();
		const canonical = await fs.realpath(root);
		mocks.createAsync.mockResolvedValue({ generateAsync: mocks.generateAsync });
		speaking();
		const results = await synthesizeBundledNarration({
			cues: [
				{ id: "suggestion-1", text: "这里点击按钮。" },
				{ id: "suggestion-2", text: "然后放大显示。" },
			],
			outputDirectory: path.join(root, "out"),
		});
		expect(mocks.createAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				model: expect.objectContaining({
					vits: expect.objectContaining({ model: path.join(canonical, "model.onnx") }),
					numThreads: ttsThreads(),
				}),
				ruleFsts: [
					path.join(canonical, "date.fst"),
					path.join(canonical, "phone.fst"),
					path.join(canonical, "number.fst"),
					path.join(canonical, "new_heteronym.fst"),
				].join(","),
			}),
		);
		expect(mocks.generateAsync).toHaveBeenCalledTimes(2);
		expect(mocks.generateAsync).toHaveBeenCalledWith({
			text: "这里点击按钮。",
			sid: 0,
			speed: 1,
			enableExternalBuffer: false,
		});
		expect(mocks.writeWave).toHaveBeenCalledTimes(2);
		expect(results).toEqual([
			{
				id: "suggestion-1",
				audioPath: expect.stringMatching(/narration-zh-[a-z0-9]+-suggestion-1\.wav$/),
				durationMs: 1075,
				chunks: [{ text: "这里点击按钮。", endMs: 1075 }],
			},
			{
				id: "suggestion-2",
				audioPath: expect.stringMatching(/narration-zh-[a-z0-9]+-suggestion-2\.wav$/),
				durationMs: 1075,
				chunks: [{ text: "然后放大显示。", endMs: 1075 }],
			},
		]);
	});
	it("prefers Kokoro: one engine for Chinese, English and mixed lines, loaded and hashed once", async () => {
		asWindows();
		const { base } = await fixture();
		const { root } = await fixture("tts-kokoro", KOKORO, base);
		const canonical = await fs.realpath(root);
		mocks.createAsync.mockResolvedValue({ generateAsync: mocks.generateAsync });
		speaking();
		const out = path.join(base, "out");
		await synthesizeBundledNarration({
			cues: [{ id: "suggestion-1", text: "点击“Settings”打开设置，然后选择 Dark mode。" }],
			outputDirectory: out,
		});
		expect(mocks.createAsync).toHaveBeenCalledTimes(1);
		expect(mocks.createAsync).toHaveBeenCalledWith({
			model: {
				kokoro: {
					model: path.join(canonical, "model.onnx"),
					voices: path.join(canonical, "voices.bin"),
					tokens: path.join(canonical, "tokens.txt"),
					dataDir: path.join(canonical, "espeak-ng-data"),
					lexicon: [
						path.join(canonical, "lexicon-us-en.txt"),
						path.join(canonical, "lexicon-zh.txt"),
					].join(","),
					lengthScale: 1,
				},
				numThreads: ttsThreads(),
				provider: "cpu",
			},
			ruleFsts: ["date-zh.fst", "phone-zh.fst", "number-zh.fst"]
				.map((name) => path.join(canonical, name))
				.join(","),
			maxNumSentences: 1,
			silenceScale: 1,
		});
		// The whole sentence in one call, with the default Chinese voice and natural pauses.
		expect(mocks.generateAsync).toHaveBeenCalledWith({
			text: "点击“Settings”打开设置，然后选择 Dark mode。",
			sid: 48,
			speed: 1,
			enableExternalBuffer: false,
			generationConfig: { sid: 48, speed: 1, silenceScale: 1 },
		});
		const reads = vi.mocked(createReadStream).mock.calls.length;
		await synthesizeBundledNarration({
			cues: [{ id: "suggestion-1", text: "Wait 5 seconds." }],
			outputDirectory: out,
			language: "en",
			speakerId: 16,
		});
		expect(mocks.generateAsync).toHaveBeenLastCalledWith(
			expect.objectContaining({
				text: "Wait five seconds.",
				generationConfig: { sid: 16, speed: 1, silenceScale: 1 },
			}),
		);
		expect(mocks.createAsync).toHaveBeenCalledTimes(1);
		expect(vi.mocked(createReadStream).mock.calls.length).toBe(reads);
		// A Chinese voice is not offered for English lines, nor the other way round.
		await expect(
			synthesizeBundledNarration({
				cues: [{ id: "suggestion-1", text: "Hello." }],
				outputDirectory: out,
				language: "en",
				speakerId: 47,
			}),
		).rejects.toThrow("Invalid narration speaker");
	});
	it("previews the chosen voice with one short fixed sentence", async () => {
		asWindows();
		await fixture("tts-kokoro", KOKORO);
		mocks.createAsync.mockResolvedValue({ generateAsync: mocks.generateAsync });
		speaking();
		const preview = await previewBundledVoice({ language: "zh", speakerId: 50 });
		expect(preview.sampleRate).toBe(8000);
		expect(preview.samples.length).toBeGreaterThan(0);
		expect(mocks.generateAsync).toHaveBeenCalledTimes(1);
		expect(mocks.generateAsync).toHaveBeenCalledWith(
			expect.objectContaining({ sid: 50, text: expect.stringMatching(/\p{Script=Han}/u) }),
		);
		await expect(previewBundledVoice({ language: "zh", speakerId: 3 })).rejects.toThrow(
			"Invalid narration speaker",
		);
	});
});

describe("speaking a narration line", () => {
	// Behaves like the real addon inside Electron, whose V8 sandbox refuses the addon's
	// default external buffers ("TTS settlement failed"), and which cannot say some pieces.
	const engine = (silent: string[] = [], audio = () => tone(1)) => ({
		generateAsync: vi.fn(async (request: { text: string; enableExternalBuffer?: boolean }) => {
			if (request.enableExternalBuffer !== false) throw new Error("TTS settlement failed");
			if (silent.includes(request.text)) throw new Error("TTS generation produced no audio");
			return { samples: audio(), sampleRate: 8000 };
		}),
	});
	it("speaks each sentence whole, trimmed, with a pause between sentences", async () => {
		const tts = engine();
		const line = await speakLine(tts, "Click save. Then wait.", { speakerId: 3 });
		expect(tts.generateAsync).toHaveBeenCalledTimes(2);
		// 1 s of speech plus 25 ms before and 50 ms after it; then a 340 ms pause.
		expect(line?.chunks).toEqual([
			{ text: "Click save.", endMs: 1415 },
			{ text: "Then wait.", endMs: 2490 },
		]);
		expect(line?.durationMs).toBe(2490);
		expect(line?.samples).toHaveLength(2490 * 8);
		expect(line?.samples[1200 * 8]).toBe(0);
		// Faded in from silence, so the join cannot click.
		expect(line?.samples[0]).toBe(0);
	});
	it("brings the line to -16 LUFS without letting a peak past -1.5 dBFS", async () => {
		const quiet = await speakLine(
			engine([], () => tone(2, 8000, 0.2, 0.3, 0.02)),
			"Hello.",
			{
				speakerId: 0,
			},
		);
		const loud = await speakLine(
			engine([], () => tone(2, 8000, 0.2, 0.3, 0.9)),
			"Hello.",
			{
				speakerId: 0,
			},
		);
		for (const line of [quiet, loud]) {
			expect(integratedLoudness(line?.samples as Float32Array, 8000)).toBeCloseTo(-16, 1);
			expect(toDb(samplePeak(line?.samples as Float32Array))).toBeLessThanOrEqual(-1.5);
		}
		expect(quiet?.loudness.gainDb).toBeGreaterThan(0);
		expect(loud?.loudness.gainDb).toBeLessThan(0);
	});
	it("keeps commas inside one call and times the subtitle chunks inside the sentence", async () => {
		const tts = engine();
		const line = await speakLine(tts, "先点击设置，然后打开菜单。", { speakerId: 0 });
		expect(tts.generateAsync).toHaveBeenCalledTimes(1);
		expect(tts.generateAsync).toHaveBeenCalledWith(
			expect.objectContaining({ text: "先点击设置，然后打开菜单。" }),
		);
		// Six spoken characters each (the comma counts as one): half the sentence each.
		expect(line?.chunks).toEqual([
			{ text: "先点击设置，", endMs: 538 },
			{ text: "然后打开菜单。", endMs: 1075 },
		]);
	});
	it("shortens a long pause inside a sentence and changes the subtitle on it", async () => {
		// Kokoro leaves about 1.1 s where it reads a sentence in two parts.
		const twoParts = () => concat(tone(0.6, 8000, 0.2, 0), tone(0.6, 8000, 1.1, 0.3));
		const line = await speakLine(engine([], twoParts), "先点击设置，然后打开菜单。", {
			speakerId: 0,
		});
		// 0.625 s, a 0.26 s pause instead of 1.1 s, then 0.65 s.
		expect(line?.durationMs).toBe(1535);
		// The first subtitle ends where the voice resumes, not at its share of the characters.
		expect(line?.chunks).toEqual([
			{ text: "先点击设置，", endMs: 885 },
			{ text: "然后打开菜单。", endMs: 1535 },
		]);
		const shaped = shapeSentence(twoParts(), 8000);
		expect(shaped?.pauses).toEqual([{ start: 5000, end: 7080 }]);
	});
	it("asks Kokoro to keep its own pauses, with the chosen speaker", async () => {
		const tts = engine();
		await speakLine(tts, "你好。", { speakerId: 47, kokoro: true });
		expect(tts.generateAsync).toHaveBeenCalledWith({
			text: "你好。",
			sid: 47,
			speed: 1,
			enableExternalBuffer: false,
			generationConfig: { sid: 47, speed: 1, silenceScale: 1 },
		});
	});
	it("shows a sentence the voice cannot say with its neighbour instead of failing the line", async () => {
		const first = await speakLine(engine(["Open “GitHub”."]), "Open “GitHub”. Then save.", {
			speakerId: 0,
		});
		expect(first?.chunks).toEqual([{ text: "Open “GitHub”. Then save.", endMs: 1075 }]);
		const zh = await speakLine(engine(["Settings。"]), "先点击设置。Settings。然后保存。", {
			speakerId: 0,
		});
		expect(zh?.chunks.map((c) => c.text)).toEqual(["先点击设置。Settings。", "然后保存。"]);
		expect(await speakLine(engine(["Hmm."]), "Hmm.", { speakerId: 0 })).toBeNull();
		// Audio that never rises above the silence floor counts as nothing said.
		const hiss = () => new Float32Array(8000).fill(0.001);
		expect(await speakLine(engine([], hiss), "Hmm.", { speakerId: 0 })).toBeNull();
	});
	it("still fails on a real engine error, and reads the rewritten text", async () => {
		const broken = { generateAsync: vi.fn().mockRejectedValue(new Error("model crashed")) };
		await expect(speakLine(broken, "Hello.", { speakerId: 0 })).rejects.toThrow(
			"model crashed",
		);
		const tts = engine();
		const line = await speakLine(tts, "Wait 5 seconds.", {
			speakerId: 0,
			spoken: spokenEnglish,
		});
		expect(tts.generateAsync).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Wait five seconds.", sid: 0 }),
		);
		// The subtitle keeps the line as written.
		expect(line?.chunks[0].text).toBe("Wait 5 seconds.");
	});
	it("pauses 300 to 380 ms between sentences, by punctuation, the same way every time", () => {
		const pauses = [0, 1, 2, 3, 4, 5].map((i) => sentencePauseS("好。", i));
		expect(new Set(pauses).size).toBeGreaterThan(1);
		expect(pauses).toEqual([0, 1, 2, 3, 4, 5].map((i) => sentencePauseS("好。", i)));
		for (const text of ["好。", "好吗？", "好；", "Done.", "Ready?"])
			for (const i of [0, 1, 2, 3]) {
				expect(sentencePauseS(text, i)).toBeGreaterThanOrEqual(0.3);
				expect(sentencePauseS(text, i)).toBeLessThanOrEqual(0.38);
			}
		expect(sentencePauseS("好吗？", 0)).toBeGreaterThan(sentencePauseS("好；", 0));
	});
	it("uses two to four threads", () => {
		expect([1, 2, 3, 4, 5, 8, 32].map((cores) => ttsThreads(cores))).toEqual([
			2, 2, 2, 3, 4, 4, 4,
		]);
	});
	it("says numbers and curly apostrophes in words the English voice knows", () => {
		expect(spokenEnglish("Step 2.")).toBe("Step two.");
		expect(spokenEnglish("Version 2.0 uses 1,250 MB")).toBe(
			"Version two point zero uses one thousand two hundred fifty MB",
		);
		expect(spokenEnglish("the 3rd and 21st tabs, 40th row")).toBe(
			"the third and twenty first tabs, fortieth row",
		);
		expect(spokenEnglish("50% done in 1080p")).toBe(
			"fifty percent done in one thousand eighty p",
		);
		expect(spokenEnglish("Room 007")).toBe("Room zero zero seven");
		expect(spokenEnglish("That’s it, you’re done.")).toBe("That's it, you're done.");
	});
});

describe("loading the sherpa-onnx voice engine", () => {
	it("finds OfflineTts whether import() exposes named exports or only default", async () => {
		class OfflineTts {}
		// Vitest (and bundlers) give named exports; native Node import() of this CommonJS
		// module in the built app gives only `default`.
		expect(sherpaExports({ OfflineTts }).OfflineTts).toBe(OfflineTts);
		expect(sherpaExports({ default: { OfflineTts } }).OfflineTts).toBe(OfflineTts);
	});
	it("matches what real Node does with the installed package", () => {
		const out = execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				"const m = await import('sherpa-onnx-node'); console.log(typeof m.OfflineTts, typeof m.default?.OfflineTts)",
			],
			{ encoding: "utf8" },
		).trim();
		expect(out).toBe("undefined function");
	});
});
