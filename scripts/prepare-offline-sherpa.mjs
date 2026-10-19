// Build-machine only; the installed app never fetches a runtime or model.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-sherpa.lock.json"), "utf8"),
);
const destination = path.join(root, "vendor/offline-tools/win32-x64/sherpa");
const temporary = path.join(root, ".tmp/sherpa-assets");
const runtimeOnly = process.argv.includes("--runtime-only");
const verifyOnly = process.argv.includes("--verify");
const msvcLock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-msvc.lock.json"), "utf8"),
);
async function hash(file) {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(file)) h.update(chunk);
	return h.digest("hex");
}
async function valid(file, entry) {
	return (
		(await fs.stat(file).catch(() => null))?.size === entry.bytes &&
		(await hash(file)) === entry.sha256
	);
}
async function download(entry, file) {
	if (await valid(file, entry)) return;
	await fs.mkdir(path.dirname(file), { recursive: true });
	const partial = `${file}.download`;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			console.log(`Preparing pinned Sherpa asset: ${path.basename(file)}`);
			const response = await fetch(entry.url, { signal: AbortSignal.timeout(600000) });
			if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
			let received = 0;
			const limiter = async function* (source) {
				for await (const chunk of source) {
					received += chunk.length;
					if (received > entry.bytes) throw new Error("Oversized asset response");
					yield chunk;
				}
			};
			await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(partial));
			if (!(await valid(partial, entry)))
				throw new Error(`Checksum mismatch: ${path.basename(file)}`);
			await fs.rename(partial, file);
			return;
		} catch (error) {
			if (attempt === 2) throw error;
		}
	}
}
const runtimeRequired = [
	...lock.runtimeFiles.map((x) => `runtime/${x.path}`),
	...msvcLock.files.map((x) => `runtime/${x.path}`),
	"runtime/MSVC-NOTICE.txt",
	"runtime/jsox-sherpa-asr.exe",
	"runtime/BUILD-INFO.json",
	"runtime/TOOLCHAIN-LICENSE.txt",
	...lock.licenses.slice(0, 3).map((x) => `runtime/${x.path}`),
	"runtime/NOTICE.txt",
];
const modelRequired = [
	...lock.modelFiles.map((x) => `models/${x.path}`),
	"models/WHISPER-LICENSE.txt",
	"models/NOTICE.txt",
];
async function verify(manifestName, required) {
	const manifest = JSON.parse(await fs.readFile(path.join(destination, manifestName), "utf8"));
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.files) ||
		required.some((file) => !manifest.files.some((entry) => entry.path === file))
	)
		throw new Error("Incomplete Sherpa bundle manifest");
	const seen = new Set();
	for (const entry of manifest.files) {
		if (
			!/^(?:runtime|models)\/[A-Za-z0-9_.-]+$/.test(entry.path) ||
			entry.path.includes("..") ||
			seen.has(entry.path.toLowerCase()) ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes < 1 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256) ||
			!(await valid(path.join(destination, entry.path), entry))
		)
			throw new Error(`Invalid Sherpa asset: ${entry.path}`);
		seen.add(entry.path.toLowerCase());
	}
	return manifest;
}
if (verifyOnly) {
	await verify("manifest.json", runtimeRequired);
	if (!runtimeOnly) await verify("model-manifest.json", modelRequired);
	console.log("Pinned Sherpa bundle verified; no network used");
	process.exit(0);
}
if (process.platform !== "win32" || process.arch !== "x64")
	throw new Error("Prepare Sherpa bundle on Windows x64");
await fs.mkdir(path.join(destination, "runtime"), { recursive: true });
execFileSync(process.execPath, [path.join(root, "scripts/prepare-offline-msvc.mjs")], {
	windowsHide: true,
	stdio: "inherit",
});
for (const entry of msvcLock.files)
	await fs.copyFile(
		path.join(root, "vendor/offline-tools/win32-x64/msvc", entry.path),
		path.join(destination, "runtime", entry.path),
	);
await fs.copyFile(
	path.join(root, "vendor/offline-tools/win32-x64/msvc/NOTICE.txt"),
	path.join(destination, "runtime/MSVC-NOTICE.txt"),
);
await download(lock.runtime, path.join(temporary, "npm-win-x64.tgz"));
execFileSync("tar", ["-xf", path.join(temporary, "npm-win-x64.tgz"), "-C", temporary], {
	windowsHide: true,
});
const ortDirectory = path.join(temporary, `ort-${lock.onnxRuntime.version}`);
await fs.mkdir(ortDirectory, { recursive: true });
const ortArchive = path.join(temporary, `ort-${lock.onnxRuntime.version}.nupkg`);
await download(lock.onnxRuntime, ortArchive);
execFileSync(
	"tar",
	[
		"-xf",
		ortArchive,
		"-C",
		ortDirectory,
		"runtimes/win-x64/native/onnxruntime.dll",
		"runtimes/win-x64/native/onnxruntime_providers_shared.dll",
		"LICENSE",
		"ThirdPartyNotices.txt",
	],
	{ windowsHide: true },
);
for (const entry of lock.runtimeFiles) {
	const source =
		entry.source === "onnxRuntime"
			? path.join(ortDirectory, entry.archivePath)
			: path.join(temporary, "package", entry.path);
	if (!(await valid(source, entry)))
		throw new Error(`Pinned runtime DLL mismatch: ${entry.path}`);
	await fs.copyFile(source, path.join(destination, "runtime", entry.path));
}
const header = path.join(temporary, "include/sherpa-onnx/c-api/c-api.h");
await download(lock.header, header);
for (const entry of lock.licenses.slice(0, 3)) {
	if (entry.source === "onnxRuntime") {
		const source = path.join(ortDirectory, entry.archivePath);
		if (!(await valid(source, entry))) throw Error("ONNX Runtime license integrity mismatch");
		await fs.copyFile(source, path.join(destination, "runtime", entry.path));
	} else await download(entry, path.join(destination, "runtime", entry.path));
}
const toolsLock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-ai-build.lock.json"), "utf8"),
);
const toolArchive = path.join(root, ".tmp/offline-build-tools", toolsLock.llvm.file);
if (
	!(await valid(toolArchive, {
		bytes: (await fs.stat(toolArchive)).size,
		sha256: toolsLock.llvm.sha256,
	}))
)
	throw new Error(
		"Pinned portable LLVM archive missing; run build-offline-whisper-runtime.mjs on the build machine first",
	);
const compiler = path.join(
	root,
	".tmp/offline-build-tools",
	toolsLock.llvm.directory,
	"bin/x86_64-w64-mingw32-clang++.exe",
);
const source = path.join(root, "scripts/sherpa-asr.cpp");
execFileSync(
	compiler,
	[
		"-O2",
		"-std=c++17",
		"-static",
		"-municode",
		"-I",
		path.join(temporary, "include"),
		source,
		"-o",
		path.join(destination, "runtime/jsox-sherpa-asr.exe"),
	],
	{ windowsHide: true, stdio: "inherit" },
);
await fs.copyFile(
	path.join(root, "vendor/offline-ai/win32-x64/speech/runtime/TOOLCHAIN-LICENSE.txt"),
	path.join(destination, "runtime/TOOLCHAIN-LICENSE.txt"),
);
await fs.writeFile(
	path.join(destination, "runtime/BUILD-INFO.json"),
	JSON.stringify(
		{
			version: 1,
			runtimeVersion: lock.runtimeVersion,
			headerSha256: lock.header.sha256,
			sourceSha256: await hash(source),
			compilerArchiveSha256: toolsLock.llvm.sha256,
			helperSha256: await hash(path.join(destination, "runtime/jsox-sherpa-asr.exe")),
		},
		null,
		2,
	),
);
await fs.writeFile(
	path.join(destination, "runtime/NOTICE.txt"),
	`Jsox offline Sherpa runtime\nsherpa-onnx ${lock.runtimeVersion}, Apache-2.0, https://github.com/k2-fsa/sherpa-onnx\nOfficial npm Windows x64 package: ${lock.runtime.url}\nONNX Runtime dependency, MIT; see ORT-LICENSE.txt and ORT-NOTICES.txt.\nJsox helper source: scripts/sherpa-asr.cpp (repository AGPL-3.0).\nNo Node addon, Python, global install or network service is used by installed customers.\n`,
);
async function writeManifest(name, files, modelName) {
	const entries = [];
	for (const file of files)
		entries.push({
			path: file,
			bytes: (await fs.stat(path.join(destination, file))).size,
			sha256: await hash(path.join(destination, file)),
		});
	await fs.writeFile(
		path.join(destination, name),
		JSON.stringify(
			{ version: 1, runtimeVersion: lock.runtimeVersion, modelName, files: entries },
			null,
			2,
		),
	);
}
await writeManifest("manifest.json", runtimeRequired);
if (!runtimeOnly) {
	await fs.mkdir(path.join(destination, "models"), { recursive: true });
	for (const entry of lock.modelFiles)
		await download(
			{ ...entry, url: `${lock.modelSource}/resolve/${lock.modelRevision}/${entry.path}` },
			path.join(destination, "models", entry.path),
		);
	await download(lock.licenses[3], path.join(destination, "models/WHISPER-LICENSE.txt"));
	await fs.writeFile(
		path.join(destination, "models/NOTICE.txt"),
		`Model: ${lock.modelName}\nOriginal OpenAI Whisper model weights: MIT, https://github.com/openai/whisper\nConverted by sherpa-onnx, Apache-2.0.\nConversion source: ${lock.modelSource}\nRevision: ${lock.modelRevision}\nSmaller base model is an optional comparison; Whisper small remains the default for safe automatic editing.\n`,
	);
	await writeManifest("model-manifest.json", modelRequired, lock.modelName);
}
await verify("manifest.json", runtimeRequired);
if (!runtimeOnly) await verify("model-manifest.json", modelRequired);
console.log("Shared Sherpa C API runtime and optional ASR bundle ready");
