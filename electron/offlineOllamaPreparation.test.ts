import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	parseModelManifest,
	prepareOllamaBundle,
	safeRelative,
	verifyOllamaBundle,
} from "../scripts/prepare-offline-ollama.mjs";
import officialRuntime from "./ipc/autoEdit/fixtures/ollama-v0.40.11-windows-amd64-files.json";

const roots: string[] = [];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const manifestPath = "models/manifests/registry.ollama.ai/library/qwen3/1.7b";
async function fixture(runtimeFiles: string[] = []) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-ollama-build-"));
	roots.push(directory);
	const root = path.join(directory, "bundle");
	const exe = Buffer.alloc(96);
	exe.write("MZ");
	exe.writeUInt32LE(64, 60);
	exe.write("PE\0\0", 64);
	exe.writeUInt16LE(0x8664, 68);
	const license = "Apache License\nVersion 2.0\nSynthetic test license text";
	const config = '{"model_format":"gguf","model_family":"qwen3"}';
	const model = "Synthetic model bytes; never inference or an executable";
	const descriptor = (value: string, mediaType: string) => ({
		mediaType,
		digest: `sha256:${sha(value)}`,
		size: Buffer.byteLength(value),
	});
	const registry = JSON.stringify({
		schemaVersion: 2,
		config: descriptor(config, "application/vnd.docker.container.image.v1+json"),
		layers: [
			descriptor(model, "application/vnd.ollama.image.model"),
			descriptor(license, "application/vnd.ollama.image.license"),
		],
	});
	const contents: Record<string, string | Buffer> = {
		"runtime/ollama.exe": exe,
		"runtime/lib/ollama/CPU-LICENSE.txt": "Synthetic runtime library notice",
		[manifestPath]: registry,
		[`models/blobs/sha256-${sha(model)}`]: model,
		[`models/blobs/sha256-${sha(config)}`]: config,
		[`models/blobs/sha256-${sha(license)}`]: license,
		"OLLAMA-LICENSE.txt": "MIT synthetic runtime license",
		"MODEL-LICENSE.txt": license,
		"NOTICE.txt": "Synthetic preparation fixture",
		...Object.fromEntries(
			runtimeFiles
				.filter((file) => file !== "ollama.exe")
				.map((file) => [`runtime/${file}`, `Synthetic copy of ${file}`]),
		),
	};
	for (const [file, value] of Object.entries(contents)) {
		await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
		await fs.writeFile(path.join(root, file), value);
	}
	const lock = {
		runtimeVersion: "synthetic-fixture",
		runtime: {
			sha256: sha("trusted archive"),
			file: "fixture.zip",
			size: 15,
			url: "https://invalid.example/not-called",
		},
		license: {
			sha256: sha(contents["OLLAMA-LICENSE.txt"]),
			size: Buffer.byteLength(contents["OLLAMA-LICENSE.txt"]),
			url: "https://invalid.example/not-called",
		},
		model: {
			name: "qwen3:1.7b",
			manifestPath,
			manifestSha256Prefix: sha(registry).slice(0, 12),
			registry: "https://invalid.example/not-called",
			modelSource: "synthetic fixture",
			manifestPinProvenance: "Synthetic fixture only",
		},
	};
	const manifest = {
		version: 1,
		modelName: "qwen3:1.7b",
		runtimeVersion: lock.runtimeVersion,
		runtimeArchiveSha256: lock.runtime.sha256,
		modelManifestSha256: sha(registry),
		files: Object.entries(contents).map(([file, value]) => ({
			file,
			size: Buffer.byteLength(value),
			sha256: sha(value),
		})),
	};
	await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	return { root, directory, manifest, lock, registry, model, contents };
}
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

describe("offline Ollama build preparation", () => {
	it("verifies the full copied client tree including registry content descriptors", async () => {
		const f = await fixture();
		expect((await verifyOllamaBundle(f.root, f.lock)).modelName).toBe("qwen3:1.7b");
	});
	it("accepts every file name of the pinned official Windows runtime, including libc++.dll", async () => {
		const f = await fixture(officialRuntime.files);
		expect(Object.keys(f.contents)).toContain("runtime/lib/ollama/libc++.dll");
		await expect(verifyOllamaBundle(f.root, f.lock)).resolves.toBeDefined();
	});
	it("rejects a listed file whose name the installed app would refuse", async () => {
		const f = await fixture();
		const file = "runtime/lib/ollama/name with space.dll";
		await fs.writeFile(path.join(f.root, file), "renamed library");
		f.manifest.files.push({ file, size: 15, sha256: sha("renamed library") });
		await fs.writeFile(path.join(f.root, "manifest.json"), JSON.stringify(f.manifest));
		await expect(verifyOllamaBundle(f.root, f.lock)).rejects.toThrow("Invalid bundled");
	});
	it("rejects a missing model layer even when a generated receipt was edited to omit it", async () => {
		const f = await fixture();
		const blob = `models/blobs/sha256-${sha(f.model)}`;
		await fs.rm(path.join(f.root, blob));
		f.manifest.files = f.manifest.files.filter((entry) => entry.file !== blob);
		await fs.writeFile(path.join(f.root, "manifest.json"), JSON.stringify(f.manifest));
		await expect(verifyOllamaBundle(f.root, f.lock)).rejects.toThrow("model blob");
	});
	it("rejects modified blob data", async () => {
		const f = await fixture();
		await fs.writeFile(path.join(f.root, `models/blobs/sha256-${sha(f.model)}`), "tampered");
		await expect(verifyOllamaBundle(f.root, f.lock)).rejects.toThrow("Invalid bundled");
	});
	it("rejects unlisted files that would otherwise be packed with the runtime", async () => {
		const f = await fixture();
		await fs.writeFile(path.join(f.root, "runtime/unexpected.dll"), "unlisted");
		await expect(verifyOllamaBundle(f.root, f.lock)).rejects.toThrow("Unlisted");
	});
	it("rejects symlink entries", async () => {
		const f = await fixture();
		await fs.symlink(
			path.join(f.root, "runtime"),
			path.join(f.root, "linked-runtime"),
			process.platform === "win32" ? "junction" : "dir",
		);
		await expect(verifyOllamaBundle(f.root, f.lock)).rejects.toThrow("Unsafe staged");
	});
	it("requires the pinned runtime archive provenance receipt", async () => {
		const f = await fixture();
		f.manifest.runtimeArchiveSha256 = sha("other archive");
		await fs.writeFile(path.join(f.root, "manifest.json"), JSON.stringify(f.manifest));
		await expect(verifyOllamaBundle(f.root, f.lock)).rejects.toThrow("archive provenance");
	});
	it("rejects a source manifest different from the selected model snapshot", async () => {
		const f = await fixture();
		expect(() =>
			parseModelManifest(Buffer.from(`${f.registry}\n`), f.lock.model.manifestSha256Prefix),
		).toThrow("repin");
	});
	it.each([
		"../escape",
		"/absolute",
		"C:/absolute",
		"runtime/../escape",
		"runtime\\escape",
		"runtime//escape",
	])("rejects unsafe paths: %s", (file) => {
		expect(safeRelative(file)).toBe(false);
	});
	it("rejects a model without a license descriptor", async () => {
		const f = await fixture();
		const value = JSON.parse(f.registry);
		value.layers = value.layers.slice(0, 1);
		expect(() => parseModelManifest(Buffer.from(JSON.stringify(value)))).toThrow("license");
	});
	it("rejects malformed content digests and oversized model sets", async () => {
		const f = await fixture();
		const value = JSON.parse(f.registry);
		value.config.digest = "sha256:../../escape";
		expect(() => parseModelManifest(Buffer.from(JSON.stringify(value)))).toThrow("descriptor");
		value.config.digest = `sha256:${sha("config")}`;
		value.layers[0].size = 2000000001;
		expect(() => parseModelManifest(Buffer.from(JSON.stringify(value)))).toThrow("descriptor");
	});
	it("prepares offline from a pinned local archive and an existing model store, preserving all runtime notices", async () => {
		const f = await fixture();
		const archive = path.join(f.directory, "runtime-fixture.zip");
		execFileSync("tar", [
			"-cf",
			archive,
			"-C",
			path.join(f.root, "runtime"),
			"ollama.exe",
			"lib",
		]);
		const archiveData = await fs.readFile(archive);
		f.lock.runtime = { ...f.lock.runtime, size: archiveData.length, sha256: sha(archiveData) };
		const cache = path.join(f.directory, "cache");
		await fs.mkdir(cache);
		await fs.writeFile(
			path.join(cache, "OLLAMA-LICENSE.txt"),
			f.contents["OLLAMA-LICENSE.txt"],
		);
		const destination = path.join(f.directory, "prepared");
		const result = await prepareOllamaBundle({
			root: destination,
			lock: f.lock,
			modelsFrom: path.join(f.root, "models"),
			runtimeFrom: archive,
			cache,
		});
		expect(result.modelManifestSha256).toBe(sha(f.registry));
		expect(
			await fs.readFile(path.join(destination, "runtime/lib/ollama/CPU-LICENSE.txt"), "utf8"),
		).toContain("notice");
		expect(
			result.files.some((entry: { file: string }) => entry.file.endsWith(".download")),
		).toBe(false);
		await expect(verifyOllamaBundle(destination, f.lock)).resolves.toBeDefined();
	});
	it("leaves out the pinned GPU backends after verifying the archive and adds the runtime library notices", async () => {
		const f = await fixture();
		const runtime = path.join(f.directory, "official-runtime");
		await fs.cp(path.join(f.root, "runtime"), runtime, { recursive: true });
		for (const file of [
			"lib/ollama/cuda_v12/cublasLt64_12.dll",
			"lib/ollama/cuda_v13/cudart64_13.dll",
			"lib/ollama/vulkan/ggml-vulkan.dll",
			"lib/ollama/libc++.dll",
		]) {
			await fs.mkdir(path.dirname(path.join(runtime, file)), { recursive: true });
			await fs.writeFile(path.join(runtime, file), `Synthetic ${file}`);
		}
		const archive = path.join(f.directory, "runtime-with-gpu.zip");
		execFileSync("tar", ["-cf", archive, "-C", runtime, "ollama.exe", "lib"]);
		const archiveData = await fs.readFile(archive);
		const cache = path.join(f.directory, "cache");
		await fs.mkdir(path.join(cache, "licenses"), { recursive: true });
		await fs.writeFile(
			path.join(cache, "OLLAMA-LICENSE.txt"),
			f.contents["OLLAMA-LICENSE.txt"],
		);
		const notice = "Apache License v2.0 with LLVM Exceptions (synthetic)";
		await fs.writeFile(path.join(cache, "licenses/LLVM-LICENSE.txt"), notice);
		const lock = {
			...f.lock,
			runtime: {
				...f.lock.runtime,
				size: archiveData.length,
				sha256: sha(archiveData),
				excludedPaths: ["lib/ollama/cuda_v12", "lib/ollama/cuda_v13", "lib/ollama/vulkan"],
			},
			runtimeLicenses: [
				{
					file: "licenses/LLVM-LICENSE.txt",
					covers: "libc++.dll",
					url: "https://invalid.example/not-called",
					size: Buffer.byteLength(notice),
					sha256: sha(notice),
				},
			],
		};
		const destination = path.join(f.directory, "prepared-cpu");
		const result = await prepareOllamaBundle({
			root: destination,
			lock,
			modelsFrom: path.join(f.root, "models"),
			runtimeFrom: archive,
			cache,
		});
		const files = result.files.map((entry: { file: string }) => entry.file);
		expect(files).toContain("runtime/lib/ollama/libc++.dll");
		expect(files).toContain("licenses/LLVM-LICENSE.txt");
		expect(files.some((file: string) => /cuda_v1[23]|vulkan/.test(file))).toBe(false);
		expect(await fs.readFile(path.join(destination, "NOTICE.txt"), "utf8")).toContain(
			"lib/ollama/cuda_v12, lib/ollama/cuda_v13, lib/ollama/vulkan",
		);
		// A receipt that lists an excluded backend again is refused, even with matching bytes.
		const manifest = JSON.parse(
			await fs.readFile(path.join(destination, "manifest.json"), "utf8"),
		);
		const gpu = "runtime/lib/ollama/vulkan/ggml-vulkan.dll";
		await fs.mkdir(path.dirname(path.join(destination, gpu)), { recursive: true });
		await fs.writeFile(path.join(destination, gpu), "restored GPU backend");
		manifest.files.push({ file: gpu, size: 20, sha256: sha("restored GPU backend") });
		await fs.writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest));
		await expect(verifyOllamaBundle(destination, lock)).rejects.toThrow("Excluded GPU");
	});
	it("fails before replacing an existing complete bundle if a reused local model is corrupt", async () => {
		const f = await fixture();
		const archive = path.join(f.directory, "runtime-fixture.zip");
		execFileSync("tar", [
			"-cf",
			archive,
			"-C",
			path.join(f.root, "runtime"),
			"ollama.exe",
			"lib",
		]);
		const archiveData = await fs.readFile(archive);
		f.lock.runtime = { ...f.lock.runtime, size: archiveData.length, sha256: sha(archiveData) };
		const cache = path.join(f.directory, "cache");
		await fs.mkdir(cache);
		await fs.writeFile(
			path.join(cache, "OLLAMA-LICENSE.txt"),
			f.contents["OLLAMA-LICENSE.txt"],
		);
		const destination = path.join(f.directory, "previous");
		await fs.cp(f.root, destination, { recursive: true });
		await fs.writeFile(path.join(f.root, `models/blobs/sha256-${sha(f.model)}`), "corrupt");
		await expect(
			prepareOllamaBundle({
				root: destination,
				lock: f.lock,
				modelsFrom: path.join(f.root, "models"),
				runtimeFrom: archive,
				cache,
			}),
		).rejects.toThrow("checksum mismatch");
		expect(await fs.readFile(path.join(destination, "NOTICE.txt"), "utf8")).toBe(
			f.contents["NOTICE.txt"],
		);
	});
	it("refuses to replace an unrelated directory selected as build output", async () => {
		const f = await fixture();
		const destination = path.join(f.directory, "unrelated");
		await fs.mkdir(destination);
		await fs.writeFile(path.join(destination, "user-project.mp4"), "Keep this original media");
		await expect(
			prepareOllamaBundle({ root: destination, lock: f.lock, cache: f.directory }),
		).rejects.toThrow("unrelated files");
		expect(await fs.readFile(path.join(destination, "user-project.mp4"), "utf8")).toContain(
			"Keep",
		);
	});
});
