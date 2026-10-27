import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const scripts: Record<string, string> = JSON.parse(
	readFileSync(path.join(root, "package.json"), "utf8"),
).scripts;

type Resource = { from: string; to?: string; filter?: string[] };
type BuilderConfig = { extends?: string; extraResources?: Resource[] };

/** The builder configs are JSON with whole-line comments. */
function readConfig(file: string): BuilderConfig {
	const text = readFileSync(path.join(root, file), "utf8")
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n");
	return JSON.parse(text);
}

/** electron-builder appends a parent's array fields, so a config ships its parents' resources too. */
function extraResources(file: string): Resource[] {
	const config = readConfig(file);
	const inherited = config.extends ? extraResources(path.normalize(config.extends)) : [];
	return [...inherited, ...(config.extraResources ?? [])];
}

/** Every Windows package script, with the payloads its config (and the configs it extends) ships. */
const packages = Object.entries(scripts)
	.filter(([name]) => name.startsWith("package:win:"))
	.map(([name, command]) => {
		const config = command.match(/electron-builder --config (\S+)/)?.[1];
		if (!config) throw new Error(`${name} does not name its electron-builder config`);
		const resources = extraResources(config);
		const [before, after] = command.split(/electron-builder --config \S+/);
		return {
			name,
			before: before.split(" && ").map((step) => step.trim()),
			after: after.split(" && ").map((step) => step.trim()),
			voice: resources.some(
				(resource) =>
					resource.from === "vendor/offline-ai/win32-x64" &&
					!!resource.filter?.includes("tts-kokoro/**"),
			),
			ocr: resources.some((resource) => resource.from === "vendor/offline-ai/win32-x64/ocr"),
			storyModel: resources.some(
				(resource) =>
					resource.from === "vendor/offline-ai/win32-x64" &&
					!!resource.filter?.includes("*.gguf"),
			),
			ollama: resources.some((resource) => resource.from.includes("offline-ollama")),
			clientMarker: resources.some(
				(resource) =>
					resource.from === "build/complete-client.txt" &&
					resource.to === "complete-client.txt",
			),
		};
	});

describe("Windows packaging gates", () => {
	it("finds the editions that ship the narration voice and the OCR engine", () => {
		const shipping = packages.filter((edition) => edition.voice && edition.ocr);
		expect(shipping.map((edition) => edition.name).sort()).toEqual([
			"package:win:client",
			"package:win:offline",
			"package:win:speech",
			"package:win:speech-ui",
		]);
	});
	it("verifies the voice and OCR against their locks before packaging, and checks the package after", () => {
		for (const edition of packages) {
			if (edition.voice)
				expect(edition.before, edition.name).toContain("npm run verify:offline-tts");
			if (edition.ocr)
				expect(edition.before, edition.name).toContain("npm run verify:offline-ocr");
			if (edition.voice || edition.ocr)
				expect(edition.after, edition.name).toContain("npm run smoke:packaged-binaries");
		}
	});
	it("ships the built-in story model, and no separate Ollama, in every complete edition", () => {
		for (const edition of packages.filter((entry) => entry.voice && entry.ocr)) {
			expect(edition.storyModel, edition.name).toBe(true);
			expect(edition.ollama, edition.name).toBe(false);
			expect(edition.before, edition.name).toContain("npm run verify:offline-ai");
			expect(edition.after, edition.name).toContain("npm run smoke:packaged-binaries");
		}
		// The marker hides Ollama mode and keeps the ZIP away from the NSIS update feed.
		expect(packages.find((entry) => entry.name === "package:win:client")?.clientMarker).toBe(
			true,
		);
	});
	it("packs every multi-GB complete edition as ZIP only, as electron-builder resolves it", async () => {
		// electron-builder's own loader, so parent-config array merging is applied exactly as in a build.
		const { getConfig } = await import("app-builder-lib/out/util/config/config");
		const { Lazy } = await import("lazy-val");
		const packageJson = new Lazy(async () =>
			JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")),
		);
		for (const edition of packages.filter((entry) => entry.voice && entry.ocr)) {
			const config = scripts[edition.name].match(/electron-builder --config (\S+)/)![1];
			const resolved = await getConfig(root, config, null, packageJson);
			expect(resolved.win?.target, edition.name).toBe("zip");
		}
	});
	it("routes the normal Windows build through the complete client edition", () => {
		expect(scripts["build:win"]).toContain("npm run build:win:client");
		expect(scripts["build:win:client"]).toContain("npm run package:win:client");
	});
});
