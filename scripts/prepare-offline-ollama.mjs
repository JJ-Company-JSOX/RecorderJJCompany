// Build-machine tool only. The installed application does not run this script or download assets.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MODEL_MANIFEST = "models/manifests/registry.ollama.ai/library/qwen3/1.7b";
const hex = /^[a-f0-9]{64}$/;
export async function hashFile(file) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}
export function safeRelative(file) {
	return (
		typeof file === "string" &&
		!!file &&
		!file.includes("\\") &&
		!file.includes(":") &&
		!file.includes("\0") &&
		!path.posix.isAbsolute(file) &&
		file.split("/").every((part) => part && part !== "." && part !== "..")
	);
}
/**
 * The installed app accepts only these bundle paths (validRelative in
 * electron/ipc/autoEdit/bundledOllama.ts). Checking them here keeps the build and the
 * packaged smoke from passing a bundle the app would then refuse to start.
 */
export const BUNDLE_PATH =
	/^(?:runtime\/[a-zA-Z0-9_.+/-]+|models\/blobs\/sha256-[a-f0-9]{64}|models\/manifests\/registry\.ollama\.ai\/library\/qwen3\/1\.7b|(?:licenses\/)?[a-zA-Z0-9_.-]+\.(?:txt|md))$/;
export function parseModelManifest(bytes, expectedPrefix) {
	if (bytes.length > 1000000) throw Error("Model manifest is oversized");
	const sha256 = digest(bytes);
	if (expectedPrefix && !sha256.startsWith(expectedPrefix))
		throw Error(
			"Model manifest differs from the selected qwen3:1.7b snapshot; review and repin before release",
		);
	const value = JSON.parse(bytes.toString("utf8"));
	if (
		value.schemaVersion !== 2 ||
		!value.config ||
		!Array.isArray(value.layers) ||
		!value.layers.length ||
		value.layers.length > 32
	)
		throw Error("Invalid Ollama model manifest");
	let total = 0;
	const descriptors = [value.config, ...value.layers];
	for (const entry of descriptors) {
		if (
			!/^sha256:[a-f0-9]{64}$/.test(entry?.digest) ||
			!Number.isSafeInteger(entry.size) ||
			entry.size <= 0 ||
			entry.size > 2000000000 ||
			typeof entry.mediaType !== "string"
		)
			throw Error("Invalid model content descriptor");
		total += entry.size;
	}
	if (
		total > 2000000000 ||
		!value.layers.some((entry) => entry.mediaType === "application/vnd.ollama.image.license")
	)
		throw Error("Model is oversized or lacks a redistributable license layer");
	return { sha256, descriptors, total };
}
async function regularFile(file) {
	const stat = await fs.lstat(file).catch(() => null);
	if (!stat?.isFile() || stat.isSymbolicLink() || stat.size <= 0)
		throw Error(`Missing or nonregular asset: ${file}`);
	return stat;
}
async function valid(file, entry) {
	const stat = await fs.lstat(file).catch(() => null);
	return (
		!!stat?.isFile() &&
		!stat.isSymbolicLink() &&
		stat.size === entry.size &&
		(await hashFile(file)) === entry.sha256
	);
}
async function listFiles(directory, prefix = "") {
	const files = [];
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const name = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (!safeRelative(name) || entry.isSymbolicLink())
			throw Error(`Unsafe staged entry: ${name}`);
		if (entry.isDirectory())
			files.push(...(await listFiles(path.join(directory, entry.name), name)));
		else if (entry.isFile()) files.push(name);
		else throw Error(`Unexpected staged entry: ${name}`);
	}
	return files.sort();
}
/** No network and no process execution. Used for the actual copied client resources too. */
export async function verifyOllamaBundle(root, lock) {
	const manifestFile = path.join(root, "manifest.json");
	await regularFile(manifestFile);
	const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
	if (
		manifest.version !== 1 ||
		manifest.modelName !== lock.model.name ||
		manifest.runtimeVersion !== lock.runtimeVersion ||
		manifest.runtimeArchiveSha256 !== lock.runtime.sha256 ||
		!Array.isArray(manifest.files)
	)
		throw Error("Wrong offline Ollama runtime/model or missing archive provenance receipt");
	const names = new Set();
	for (const entry of manifest.files) {
		if (
			!safeRelative(entry.file) ||
			entry.file.length >= 512 ||
			!BUNDLE_PATH.test(entry.file) ||
			names.has(entry.file) ||
			!Number.isSafeInteger(entry.size) ||
			entry.size <= 0 ||
			!hex.test(entry.sha256) ||
			!(await valid(path.join(root, entry.file), entry))
		)
			throw Error(`Invalid bundled Ollama asset: ${entry?.file}`);
		names.add(entry.file);
	}
	for (const file of [
		"runtime/ollama.exe",
		MODEL_MANIFEST,
		"OLLAMA-LICENSE.txt",
		"MODEL-LICENSE.txt",
		"NOTICE.txt",
		...(lock.runtimeLicenses ?? []).map((entry) => entry.file),
	])
		if (!names.has(file)) throw Error(`Required bundled Ollama asset missing: ${file}`);
	for (const entry of lock.runtimeLicenses ?? [])
		if (manifest.files.find((item) => item.file === entry.file)?.sha256 !== entry.sha256)
			throw Error(`Runtime library license does not match its pin: ${entry.file}`);
	const excluded = (lock.runtime.excludedPaths ?? []).map((file) => `runtime/${file}/`);
	const shipped = manifest.files.find((item) =>
		excluded.some((prefix) => item.file.startsWith(prefix)),
	);
	if (shipped) throw Error(`Excluded GPU runtime file is bundled: ${shipped.file}`);
	const listed = await listFiles(root);
	if (listed.some((file) => file !== "manifest.json" && !names.has(file)))
		throw Error("Unlisted asset in Ollama bundle");
	const model = parseModelManifest(
		await fs.readFile(path.join(root, MODEL_MANIFEST)),
		lock.model.manifestSha256Prefix,
	);
	if (manifest.modelManifestSha256 !== model.sha256)
		throw Error("Model manifest receipt does not match");
	for (const entry of model.descriptors) {
		const file = `models/blobs/${entry.digest.replace(":", "-")}`;
		const record = manifest.files.find((item) => item.file === file);
		if (!record || record.sha256 !== entry.digest.slice(7) || record.size !== entry.size)
			throw Error(`Incomplete or mismatched model blob: ${file}`);
	}
	const runtime = await fs.readFile(path.join(root, "runtime/ollama.exe"));
	const pe = runtime.length >= 64 ? runtime.readUInt32LE(0x3c) : runtime.length;
	if (
		runtime.toString("ascii", 0, 2) !== "MZ" ||
		pe + 6 > runtime.length ||
		runtime.toString("ascii", pe, pe + 4) !== "PE\0\0" ||
		runtime.readUInt16LE(pe + 4) !== 0x8664
	)
		throw Error("Bundled Ollama must be a Windows x64 PE executable");
	if (
		!(await fs.readFile(path.join(root, "MODEL-LICENSE.txt"), "utf8")).includes(
			"Apache License",
		)
	)
		throw Error("Expected model license is not present");
	return manifest;
}
/** A capped, resumable download. Only build machines call it. */
async function download(entry, destination) {
	if (await valid(destination, entry)) return;
	await fs.mkdir(path.dirname(destination), { recursive: true });
	const partial = `${destination}.download`;
	for (let attempt = 0; attempt < 4; attempt++) {
		let offset = (await fs.stat(partial).catch(() => null))?.size ?? 0;
		if (offset >= entry.size) {
			if (await valid(partial, entry)) {
				await fs.rename(partial, destination);
				return;
			}
			await fs.rm(partial, { force: true });
			offset = 0;
		}
		try {
			const controller = new AbortController();
			let lastProgress = Date.now();
			const watchdog = setInterval(() => {
				if (Date.now() - lastProgress > 60000)
					controller.abort(Error("Asset download stalled"));
			}, 5000);
			try {
				console.log(
					`Preparing ${path.basename(destination)} (${entry.size} bytes)${offset ? `, resuming ${offset}` : ""}`,
				);
				const response = await fetch(entry.url, {
					headers: offset ? { Range: `bytes=${offset}-` } : {},
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3600000)]),
				});
				if (!response.ok || !response.body) throw Error(`Asset HTTP ${response.status}`);
				if (response.status === 206) {
					if (!response.headers.get("content-range")?.startsWith(`bytes ${offset}-`))
						throw Error("Invalid resumed asset range");
				} else offset = 0;
				let received = offset,
					announced = offset;
				const meter = new Transform({
					transform(chunk, _encoding, done) {
						lastProgress = Date.now();
						received += chunk.length;
						if (received > entry.size) return done(Error("Oversized asset response"));
						if (received - announced > 64 * 1024 ** 2) {
							announced = received;
							console.log(
								`${path.basename(destination)}: ${Math.floor((received / entry.size) * 100)}%`,
							);
						}
						done(null, chunk);
					},
				});
				await pipeline(
					Readable.fromWeb(response.body),
					meter,
					createWriteStream(partial, { flags: offset ? "a" : "w" }),
				);
			} finally {
				clearInterval(watchdog);
			}
			if (!(await valid(partial, entry))) {
				await fs.rm(partial, { force: true });
				throw Error("Asset checksum mismatch");
			}
			await fs.rename(partial, destination);
			return;
		} catch (error) {
			if (attempt === 3) throw error;
			console.log(`Retrying asset (${attempt + 1}/3)`);
		}
	}
}
async function fetchSmall(url, cap = 1000000) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(30000),
		headers: { Accept: "application/vnd.docker.distribution.manifest.v2+json" },
	});
	if (!response.ok || !response.body) throw Error(`Metadata HTTP ${response.status}: ${url}`);
	const chunks = [];
	let bytes = 0;
	for await (const chunk of Readable.fromWeb(response.body)) {
		bytes += chunk.length;
		if (bytes > cap) throw Error("Metadata response too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}
async function copyVerified(source, destination, entry) {
	if (!(await valid(source, entry))) throw Error(`Local source checksum mismatch: ${source}`);
	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.copyFile(source, destination);
	if (!(await valid(destination, entry))) throw Error("Copied asset failed verification");
}
async function extractRuntime(archive, destination) {
	const tar =
		process.platform === "win32"
			? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
			: "tar";
	let entries;
	try {
		entries = execFileSync(tar, ["-tf", archive], { encoding: "utf8", maxBuffer: 10000000 });
	} catch (error) {
		if (process.platform === "win32") throw error;
		entries = execFileSync("unzip", ["-Z1", archive], {
			encoding: "utf8",
			maxBuffer: 10000000,
		});
	}
	if (
		entries
			.split(/\r?\n/)
			.filter(Boolean)
			.some((file) => !safeRelative(file.replace(/\/$/, "")))
	)
		throw Error("Unsafe official runtime archive entry");
	await fs.mkdir(destination, { recursive: true });
	try {
		execFileSync(tar, ["-xf", archive, "-C", destination], {
			stdio: "inherit",
			windowsHide: true,
		});
	} catch (error) {
		if (process.platform === "win32") throw error;
		execFileSync("unzip", ["-q", archive, "-d", destination], { stdio: "inherit" });
	}
	await listFiles(destination); // Reject links and special files after extraction too.
}
export async function prepareOllamaBundle({ root, lock, modelsFrom, runtimeFrom, cache }) {
	const current = await fs.lstat(root).catch(() => null);
	if (current) {
		if (!current.isDirectory() || current.isSymbolicLink())
			throw Error("The output must be a real bundle directory");
		const known = new Set([
			"runtime",
			"models",
			"manifest.json",
			"OLLAMA-LICENSE.txt",
			"MODEL-LICENSE.txt",
			"NOTICE.txt",
			"licenses",
		]);
		if ((await fs.readdir(root)).some((name) => !known.has(name)))
			throw Error("Refusing to replace an output directory containing unrelated files");
	}
	const runtimeArchive = runtimeFrom ?? path.join(cache, lock.runtime.file);
	if (runtimeFrom) {
		if (!(await valid(runtimeArchive, lock.runtime)))
			throw Error("Runtime archive does not match the official pinned release");
	} else await download(lock.runtime, runtimeArchive);
	const licenseFile = path.join(cache, "OLLAMA-LICENSE.txt");
	await download(lock.license, licenseFile);
	const runtimeLicenses = lock.runtimeLicenses ?? [];
	for (const entry of runtimeLicenses) {
		if (!safeRelative(entry.file) || !BUNDLE_PATH.test(entry.file))
			throw Error(`Invalid runtime license path: ${entry.file}`);
		await download(entry, path.join(cache, entry.file));
	}
	let modelBytes;
	if (modelsFrom) {
		const localManifest = path.join(
			modelsFrom,
			lock.model.manifestPath.replace(/^models\//, ""),
		);
		await regularFile(localManifest);
		modelBytes = await fs.readFile(localManifest);
	} else modelBytes = await fetchSmall(`${lock.model.registry}/manifests/1.7b`);
	const model = parseModelManifest(modelBytes, lock.model.manifestSha256Prefix);
	const stage = `${root}.staging-${process.pid}-${Date.now()}`;
	await fs.mkdir(stage, { recursive: true });
	try {
		await extractRuntime(runtimeArchive, path.join(stage, "runtime"));
		// The whole archive matched its pin above; only then drop the GPU backends the CPU client never loads.
		for (const excluded of lock.runtime.excludedPaths ?? []) {
			if (!safeRelative(excluded)) throw Error(`Invalid excluded runtime path: ${excluded}`);
			await fs.rm(path.join(stage, "runtime", excluded), { recursive: true, force: true });
		}
		for (const entry of runtimeLicenses)
			await copyVerified(path.join(cache, entry.file), path.join(stage, entry.file), entry);
		await fs.mkdir(path.dirname(path.join(stage, MODEL_MANIFEST)), { recursive: true });
		await fs.writeFile(path.join(stage, MODEL_MANIFEST), modelBytes);
		for (const entry of model.descriptors) {
			const name = entry.digest.replace(":", "-");
			const destination = path.join(stage, "models/blobs", name);
			const artifact = {
				size: entry.size,
				sha256: entry.digest.slice(7),
				url: `${lock.model.registry}/blobs/${entry.digest}`,
			};
			if (modelsFrom)
				await copyVerified(path.join(modelsFrom, "blobs", name), destination, artifact);
			else {
				const cached = path.join(cache, "blobs", name);
				await download(artifact, cached);
				await copyVerified(cached, destination, artifact);
			}
		}
		const licenses = model.descriptors.filter(
			(entry) => entry.mediaType === "application/vnd.ollama.image.license",
		);
		const licenseText = (
			await Promise.all(
				licenses.map((entry) =>
					fs.readFile(
						path.join(stage, "models/blobs", entry.digest.replace(":", "-")),
						"utf8",
					),
				),
			)
		).join("\n\n");
		if (!licenseText.includes("Apache License"))
			throw Error("The model registry license is not the expected Apache license");
		await fs.writeFile(path.join(stage, "MODEL-LICENSE.txt"), licenseText);
		await fs.copyFile(licenseFile, path.join(stage, "OLLAMA-LICENSE.txt"));
		await fs.writeFile(
			path.join(stage, "NOTICE.txt"),
			`JSOX Recorder bundled local story model\nOllama ${lock.runtimeVersion}, MIT, https://github.com/ollama/ollama\nOfficial runtime archive SHA-256: ${lock.runtime.sha256}\nModel: ${lock.model.name}\nSource: ${lock.model.modelSource}\nComplete model manifest SHA-256: ${model.sha256}\nModel: Apache-2.0; registry license text accompanies this bundle.\nAcquisition: ${modelsFrom ? "exported from an existing local content-addressed Ollama model store" : "official Ollama registry over HTTPS"}.\nThe package contains the CPU runtime and the model, and performs no customer model download or global Ollama installation.\nRuntime files are copied unmodified from the official ZIP, except these GPU backends, which are removed: ${(lock.runtime.excludedPaths ?? []).join(", ") || "none"}.\nRuntime library notices: llama.cpp, its vendored code, cpp-httplib and Go in runtime/lib/ollama; ${runtimeLicenses.map((entry) => `${entry.file} for ${entry.covers}`).join("; ") || "no additional notices"}.\nModel provenance: ${lock.model.manifestPinProvenance}\n`,
		);
		const files = [];
		for (const file of await listFiles(stage)) {
			const stat = await regularFile(path.join(stage, file));
			files.push({ file, size: stat.size, sha256: await hashFile(path.join(stage, file)) });
		}
		await fs.writeFile(
			path.join(stage, "manifest.json"),
			JSON.stringify(
				{
					version: 1,
					modelName: lock.model.name,
					runtimeVersion: lock.runtimeVersion,
					runtimeArchiveSha256: lock.runtime.sha256,
					modelManifestSha256: model.sha256,
					modelAcquisition: modelsFrom ? "local-export" : "official-registry",
					files,
				},
				null,
				2,
			),
		);
		await verifyOllamaBundle(stage, lock);
		const backup = `${root}.previous-${process.pid}`;
		if (await fs.stat(root).catch(() => null)) await fs.rename(root, backup);
		try {
			await fs.rename(stage, root);
		} catch (error) {
			if (await fs.stat(backup).catch(() => null)) await fs.rename(backup, root);
			throw error;
		}
		await fs.rm(backup, { recursive: true, force: true });
		return await verifyOllamaBundle(root, lock);
	} finally {
		await fs.rm(stage, { recursive: true, force: true });
	}
}
async function main() {
	const args = process.argv.slice(2);
	const option = (name) => {
		const index = args.indexOf(name);
		if (index < 0) return undefined;
		if (!args[index + 1] || args[index + 1].startsWith("--"))
			throw Error(`Missing ${name} value`);
		return args[index + 1];
	};
	const accepted = new Set(["--verify", "--help", "--root", "--models-from", "--runtime-from"]);
	for (let i = 0; i < args.length; i++) {
		if (!accepted.has(args[i])) throw Error(`Unknown option: ${args[i]}`);
		if (["--root", "--models-from", "--runtime-from"].includes(args[i])) i++;
	}
	if (args.includes("--help")) {
		console.log(
			"Build machine only: node scripts/prepare-offline-ollama.mjs [--models-from <existing .ollama/models>] [--runtime-from <pinned official zip>] [--root <bundle directory>]\n--verify --root <directory> performs no network/process work. Customers install the completed offline client package; they never run this tool. Default preparation downloads the fixed official runtime and the selected model snapshot on the BUILD MACHINE. Existing valid staged bundles are reused. The full official runtime ZIP (~1.59 GB) is downloaded and verified; its GPU backends are then left out, so the bundled CPU runtime is ~0.1 GB. Model is ~1.4 GB.",
		);
		return;
	}
	const lock = JSON.parse(
		await fs.readFile(path.join(repository, "scripts/offline-ollama.lock.json"), "utf8"),
	);
	const root = path.resolve(
		option("--root") ?? path.join(repository, "vendor/offline-ollama/win32-x64"),
	);
	if (args.includes("--verify")) {
		const manifest = await verifyOllamaBundle(root, lock);
		console.log(
			`Offline Ollama bundle verified: ${manifest.modelName}, ${manifest.files.length} complete assets`,
		);
		return;
	}
	try {
		const existing = await verifyOllamaBundle(root, lock);
		console.log(`Reusing verified offline Ollama bundle (${existing.files.length} assets)`);
		return;
	} catch {
		/* Incomplete assets are replaced only after complete new staging passes. */
	}
	const defaultModels = process.env.OLLAMA_MODELS ?? path.join(os.homedir(), ".ollama/models");
	const requestedModels = option("--models-from");
	const modelsFrom = requestedModels
		? path.resolve(requestedModels)
		: (await fs
					.stat(
						path.join(defaultModels, "manifests/registry.ollama.ai/library/qwen3/1.7b"),
					)
					.catch(() => null))
			? defaultModels
			: undefined;
	const manifest = await prepareOllamaBundle({
		root,
		lock,
		modelsFrom,
		runtimeFrom: option("--runtime-from") ? path.resolve(option("--runtime-from")) : undefined,
		cache: path.join(repository, ".tmp/offline-ollama"),
	});
	console.log(
		`Prepared ${manifest.modelName}: ${manifest.files.length} verified files. Installed clients require no model download.`,
	);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await main();
