// Runs the real Kokoro voice when the build machine has prepared it
// (npm run prepare:offline-tts); skipped otherwise.
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ appPath: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => mocks.appPath } }));
import { synthesizeBundledNarration } from "./tts";

const bundle = fileURLToPath(
	new URL("../../../vendor/offline-ai/win32-x64/tts-kokoro", import.meta.url),
);
const voiceReady = existsSync(path.join(bundle, "manifest.json"));

const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
const arch = Object.getOwnPropertyDescriptor(process, "arch") as PropertyDescriptor;
const workingDirectory = process.cwd();
let temp = "";
afterAll(async () => {
	Object.defineProperty(process, "platform", platform);
	Object.defineProperty(process, "arch", arch);
	process.chdir(workingDirectory);
	if (temp) await fs.rm(temp, { recursive: true, force: true });
});

/** The bundle at `root`, its files linked (or copied) from the prepared one. */
async function install(root: string) {
	const manifest = JSON.parse(await fs.readFile(path.join(bundle, "manifest.json"), "utf8"));
	for (const name of ["manifest.json", ...manifest.files.map((f: { path: string }) => f.path)]) {
		const from = path.join(bundle, ...name.split("/"));
		const to = path.join(root, ...name.split("/"));
		await fs.mkdir(path.dirname(to), { recursive: true });
		await fs.link(from, to).catch(() => fs.copyFile(from, to));
	}
}

describe.skipIf(!voiceReady)("the real Kokoro voice", () => {
	it("speaks from a folder espeak-ng cannot open by full path, instead of ending the app", async () => {
		temp = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-tts-kokoro-"));
		// Non-ASCII, a comma, and longer than espeak-ng's path buffer: given by full path,
		// espeak-ng fails to start and sherpa-onnx ends the whole process.
		mocks.appPath = path.join(temp, `张三, 的文件夹 ${"x".repeat(160)}`);
		const root = path.join(mocks.appPath, "vendor", "offline-ai", "win32-x64", "tts-kokoro");
		await install(root);
		// The addon picks its native build by platform when first loaded: load this machine's.
		await import("sherpa-onnx-node");
		Object.defineProperty(process, "platform", { ...platform, value: "win32" });
		Object.defineProperty(process, "arch", { ...arch, value: "x64" });
		const out = path.join(temp, "out");
		// "Zorblax" is in neither lexicon: espeak-ng spells it out while the line is spoken.
		const [short, long] = await synthesizeBundledNarration({
			cues: [
				{ id: "short", text: "Click it." },
				{ id: "long", text: "Click Zorblax." },
			],
			outputDirectory: out,
			language: "en",
		});
		expect(process.cwd()).toBe(await fs.realpath(root));
		expect(short.durationMs).toBeGreaterThan(300);
		expect(long.durationMs).toBeGreaterThan(short.durationMs + 250);
		expect((await fs.stat(long.audioPath)).size).toBeGreaterThan(1000);
		// Chinese, with the English label said on its own.
		const [mixed] = await synthesizeBundledNarration({
			cues: [{ id: "mixed", text: "点击“Settings”打开设置。" }],
			outputDirectory: out,
		});
		expect(mixed.durationMs).toBeGreaterThan(1000);
	}, 120_000);
});
