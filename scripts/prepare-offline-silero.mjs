// Build-machine only: installed applications never download/compile VAD assets.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-silero.lock.json"), "utf8"),
);
const tools = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-ai-build.lock.json"), "utf8"),
);
const destination = path.join(root, "vendor/offline-tools/win32-x64/silero");
const verifyOnly = process.argv.includes("--verify");
const hash = async (file) =>
	createHash("sha256")
		.update(await fs.readFile(file))
		.digest("hex");
if (!verifyOnly) {
	await fs.mkdir(path.join(destination, "runtime"), { recursive: true });
	for (const asset of [lock.model, lock.license]) {
		const file = path.join(destination, asset.file);
		if ((await hash(file).catch(() => "")) === asset.sha256) continue;
		const response = await fetch(asset.url, { signal: AbortSignal.timeout(60000) });
		if (!response.ok) throw Error(`Silero download failed: ${response.status}`);
		const data = Buffer.from(await response.arrayBuffer());
		if (
			data.length !== asset.bytes ||
			createHash("sha256").update(data).digest("hex") !== asset.sha256
		)
			throw Error("Silero asset checksum mismatch");
		await fs.writeFile(`${file}.download`, data);
		await fs.rename(`${file}.download`, file);
	}
	const includeRoot = path.join(root, ".tmp/sherpa-assets/include");
	const header = path.join(includeRoot, "sherpa-onnx/c-api/c-api.h");
	const sherpaLock = JSON.parse(
		await fs.readFile(path.join(root, "scripts/offline-sherpa.lock.json"), "utf8"),
	);
	// The shared-runtime preparation owns and verifies this pinned header.
	if (!(await fs.stat(header).catch(() => null)))
		throw Error("Prepare the pinned sherpa C API header first");
	if ((await hash(header)) !== "2a1b95084be8fd1deb3228fcad2fd3f7f0258b64582f7402281ec174c7b7f4ce")
		throw Error("Sherpa C API header differs from pinned v1.13.8");
	const compiler = path.join(
		root,
		".tmp/offline-build-tools",
		tools.llvm.directory,
		"bin/x86_64-w64-mingw32-clang++.exe",
	);
	const source = path.join(root, "electron/native/offline-vad/vad.cpp");
	const executable = path.join(destination, "runtime/jsox-vad.exe");
	execFileSync(
		compiler,
		["-std=c++17", "-O2", "-static", "-municode", "-I", includeRoot, source, "-o", executable],
		{ windowsHide: true, stdio: "inherit" },
	);
	await fs.writeFile(
		path.join(destination, "runtime/BUILD-INFO.json"),
		JSON.stringify(
			{
				version: 1,
				sileroRevision: lock.revision,
				sherpaVersion: sherpaLock.runtimeVersion,
				sourceSha256: await hash(source),
				headerSha256: await hash(header),
				toolchain: tools.llvm.directory,
				executableSha256: await hash(executable),
			},
			null,
			2,
		),
	);
	await fs.writeFile(
		path.join(destination, "NOTICE.txt"),
		`Silero VAD ${lock.tag}\nRevision: ${lock.revision}\nModel and reference implementation: MIT, Silero Team.\nUses the separately bundled sherpa-onnx C API and ONNX Runtime CPU; see sherpa/runtime notices.\nJsox sidecar source: electron/native/offline-vad/vad.cpp (application license).\nNo Python, service registration, key, GPU, or runtime download required.\n`,
	);
	await fs.copyFile(
		path.join(root, ".tmp/offline-build-tools", tools.llvm.directory, "LICENSE.txt"),
		path.join(destination, "runtime/TOOLCHAIN-LICENSE.txt"),
	);
	const names = [
		lock.model.file,
		lock.license.file,
		"NOTICE.txt",
		"runtime/jsox-vad.exe",
		"runtime/BUILD-INFO.json",
		"runtime/TOOLCHAIN-LICENSE.txt",
	];
	const files = [];
	for (const name of names)
		files.push({
			path: name,
			bytes: (await fs.stat(path.join(destination, name))).size,
			sha256: await hash(path.join(destination, name)),
		});
	await fs.writeFile(
		path.join(destination, "manifest.json"),
		JSON.stringify({ version: 1, modelName: "Silero VAD 6.2.3 16k", files }, null, 2),
	);
}
const manifest = JSON.parse(await fs.readFile(path.join(destination, "manifest.json"), "utf8"));
for (const asset of [lock.model, lock.license]) {
	if (
		!manifest.files?.some(
			(file) =>
				file.path === asset.file &&
				file.bytes === asset.bytes &&
				file.sha256 === asset.sha256,
		)
	)
		throw Error("Silero manifest differs from pinned assets");
}
if (manifest.version !== 1 || !manifest.files.some((file) => file.path === "runtime/jsox-vad.exe"))
	throw Error("Incomplete Silero manifest");
for (const file of manifest.files) {
	if (
		!/^(?:runtime\/)?[a-zA-Z0-9_.-]+$/.test(file.path) ||
		file.path.includes("..") ||
		(await fs.stat(path.join(destination, file.path))).size !== file.bytes ||
		(await hash(path.join(destination, file.path))) !== file.sha256
	)
		throw Error("Silero package checksum mismatch");
}
console.log("Verified complete offline Silero VAD bundle");
