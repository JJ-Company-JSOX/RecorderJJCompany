// Developer/build-machine only. Portable tools stay in .tmp; customer machines never compile.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-ai-build.lock.json"), "utf8"),
);
const directory = path.join(root, "vendor/offline-ai/win32-x64/runtime-static");
await fs.mkdir(directory, { recursive: true });
async function hash(file) {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(file)) h.update(chunk);
	return h.digest("hex");
}
const built = JSON.parse(
	await fs.readFile(path.join(directory, "BUILD-INFO.json"), "utf8").catch(() => "null"),
);
if (
	built?.revision === lock.sourceRevision &&
	built?.staticBuild === 3 &&
	(await hash(path.join(directory, "llama-server.exe")).catch(() => "")) === built.sha256
) {
	console.log("Verified existing self-contained offline AI runtime");
	process.exit(0);
}
if (process.platform !== "win32" || process.arch !== "x64")
	throw Error("Build the Windows offline AI runtime on Windows x64");
const tools = path.join(root, ".tmp/offline-build-tools");
await fs.mkdir(tools, { recursive: true });
const sevenZip = createRequire(import.meta.url)("7zip-bin").path7za;
for (const asset of [lock.llvm, lock.cmake, lock.ninja]) {
	const zip = path.join(tools, asset.file);
	let zipChanged = false;
	if ((await hash(zip).catch(() => "")) !== asset.sha256) {
		console.log(`Downloading official portable build tool: ${asset.file}`);
		const response = await fetch(asset.url, { signal: AbortSignal.timeout(600000) });
		if (!response.ok || !response.body)
			throw Error(`Build tool download failed: ${response.status}`);
		await pipeline(Readable.fromWeb(response.body), createWriteStream(`${zip}.download`));
		if ((await hash(`${zip}.download`)) !== asset.sha256)
			throw Error("Build tool checksum mismatch");
		await fs.rename(`${zip}.download`, zip);
		zipChanged = true;
	}
	const requiredTool = asset.directory
		? path.join(
				tools,
				asset.directory,
				"bin",
				asset === lock.llvm ? "x86_64-w64-mingw32-clang.exe" : "cmake.exe",
			)
		: path.join(tools, "ninja.exe");
	// ninja has no `directory` field, so its extracted path doesn't change
	// across versions. Re-extract whenever the zip itself changed, not just
	// when the (possibly stale) extracted binary happens to be missing.
	if (zipChanged || !(await fs.stat(requiredTool).catch(() => null)))
		execFileSync(sevenZip, ["x", "-y", `-o${tools}`, zip], {
			windowsHide: true,
			stdio: "ignore",
		});
}
const source = path.join(root, ".tmp/llama-source");
if (!(await fs.stat(path.join(source, ".git")).catch(() => null)))
	execFileSync(
		"git",
		[
			"clone",
			"--depth",
			"1",
			"--branch",
			lock.sourceTag,
			"https://github.com/ggml-org/llama.cpp.git",
			source,
		],
		{ windowsHide: true, stdio: "inherit" },
	);
if (
	execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
		encoding: "utf8",
		windowsHide: true,
	}).trim() !== lock.sourceRevision
)
	throw Error("Offline AI source revision mismatch; existing source checkout preserved");
try {
	execFileSync("git", ["-C", source, "diff", "--quiet", "HEAD", "--"], {
		windowsHide: true,
		stdio: "ignore",
	});
} catch {
	throw Error("Offline AI source has tracked changes; existing source checkout preserved");
}
const compiler = path.join(tools, lock.llvm.directory, "bin"),
	cmake = path.join(tools, lock.cmake.directory, "bin/cmake.exe"),
	build = path.join(root, ".tmp/llama-static-build");
const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
env[pathKey] = `${compiler}${path.delimiter}${tools}${path.delimiter}${env[pathKey] || ""}`;
const options = { env, windowsHide: true, stdio: "inherit" };
// cpp-httplib and its public headers use Windows 10 APIs.
// Keep the pinned upstream checkout unchanged.
const compatibility = path.join(root, ".tmp/offline-win10.cmake");
await fs.writeFile(
	compatibility,
	'cmake_language(DEFER DIRECTORY "${CMAKE_SOURCE_DIR}" CALL target_compile_definitions cpp-httplib PUBLIC _WIN32_WINNT=0x0A00 WINVER=0x0A00)\n',
);
execFileSync(
	cmake,
	[
		"-S",
		source,
		"-B",
		build,
		"-G",
		"Ninja",
		"-DCMAKE_BUILD_TYPE=Release",
		`-DCMAKE_PROJECT_INCLUDE=${compatibility}`,
		`-DCMAKE_MAKE_PROGRAM=${path.join(tools, "ninja.exe")}`,
		`-DCMAKE_C_COMPILER=${path.join(compiler, "x86_64-w64-mingw32-clang.exe")}`,
		`-DCMAKE_CXX_COMPILER=${path.join(compiler, "x86_64-w64-mingw32-clang++.exe")}`,
		"-DCMAKE_EXE_LINKER_FLAGS=-static",
		"-DBUILD_SHARED_LIBS=OFF",
		"-DGGML_BACKEND_DL=OFF",
		"-DGGML_NATIVE=OFF",
		"-DGGML_AVX=ON",
		"-DGGML_AVX2=ON",
		"-DGGML_FMA=ON",
		"-DGGML_F16C=ON",
		"-DGGML_OPENMP=OFF",
		"-DGGML_RPC=OFF",
		"-DLLAMA_OPENSSL=OFF",
		"-DLLAMA_SUBPROCESS=OFF",
		"-DLLAMA_BUILD_TESTS=OFF",
		"-DLLAMA_BUILD_EXAMPLES=OFF",
		"-DLLAMA_BUILD_APP=OFF",
		"-DLLAMA_BUILD_UI=OFF",
		"-DLLAMA_USE_PREBUILT_UI=OFF",
	],
	options,
);
execFileSync(cmake, ["--build", build, "--target", "llama-server", "--parallel", "2"], options);
const executable = path.join(build, "bin/llama-server.exe");
const imports = execFileSync(
	path.join(compiler, "llvm-readobj.exe"),
	["--coff-imports", executable],
	{ encoding: "utf8", windowsHide: true },
);
const dependencies = [...imports.matchAll(/Name: ([^\r\n]+)/g)].map((match) =>
	match[1].toLowerCase(),
);
if (
	!dependencies.length ||
	dependencies.some(
		(name) =>
			!/^(?:api-ms-win-.*|ext-ms-win-.*|kernel32|advapi32|bcrypt|crypt32|ws2_32|iphlpapi|user32|shell32|ole32|oleaut32|ntdll|secur32|msvcrt|ucrtbase|version|shlwapi)\.dll$/.test(
				name,
			),
	)
)
	throw Error(`Unexpected runtime DLL dependency: ${dependencies.join(", ")}`);
execFileSync(executable, ["--help"], { windowsHide: true, stdio: "ignore" });
await fs.copyFile(executable, path.join(directory, "llama-server.exe"));
await fs.copyFile(path.join(source, "LICENSE"), path.join(directory, "LLAMA-LICENSE.txt"));
await fs.copyFile(
	path.join(tools, lock.llvm.directory, "LICENSE.TXT"),
	path.join(directory, "TOOLCHAIN-LICENSE.txt"),
);
// Upstream generates license.cpp only for its interactive app, which this server
// build deliberately excludes. Ship the licenses of the server's vendored code.
const notices = await Promise.all(
	[
		"LICENSE",
		"vendor/cpp-httplib/LICENSE",
		"licenses/LICENSE-jsonhpp",
		"vendor/hash/xxhash/LICENSE",
		"vendor/hash/sha256/LICENSE",
		"vendor/hash/rotate-bits/LICENSE.md",
	].map(
		async (file) =>
			`${file}\n${"=".repeat(file.length)}\n\n${await fs.readFile(path.join(source, file), "utf8")}`,
	),
);
// These dependencies keep their license text inside the vendored header.
// Retain each complete comment verbatim, and fail if an upstream change moves it.
async function embeddedLicense(file, marker) {
	const text = await fs.readFile(path.join(source, file), "utf8");
	const position = text.indexOf(marker);
	const start = text.lastIndexOf("/*", position);
	const end = text.indexOf("*/", position);
	if (
		position < 0 ||
		start < 0 ||
		end < position ||
		text.indexOf(marker, position + marker.length) >= 0
	)
		throw Error(`Could not identify the complete embedded license: ${file}`);
	return `${file}\n${"=".repeat(file.length)}\n\n${text.slice(start, end + 2)}`;
}
for (const [file, marker] of [
	[
		"vendor/miniaudio/miniaudio.h",
		"This software is available as a choice of the following licenses.",
	],
	[
		"vendor/stb/stb_image.h",
		"This software is available under 2 licenses -- choose whichever you prefer.",
	],
	[
		"vendor/sheredom/subprocess.h",
		"This is free and unencumbered software released into the public domain.",
	],
	["vendor/hash/sha1/sha1.h", "SHA-1 in C"],
]) {
	notices.push(await embeddedLicense(file, marker));
}
for (const file of [
	"COPYING",
	"COPYING.MinGW-w64.txt",
	"COPYING.MinGW-w64-runtime.txt",
	"COPYING.winpthreads.txt",
	"COPYING.winstorecompat.txt",
]) {
	notices.push(
		`${file}\n${"=".repeat(file.length)}\n\n${await fs.readFile(path.join(tools, lock.llvm.directory, "x86_64-w64-mingw32/share/mingw32", file), "utf8")}`,
	);
}
await fs.writeFile(path.join(directory, "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n"));
await fs.writeFile(
	path.join(directory, "BUILD-INFO.json"),
	JSON.stringify(
		{
			staticBuild: 3,
			revision: lock.sourceRevision,
			toolchain: lock.llvm.file,
			toolchainSha256: lock.llvm.sha256,
			sha256: await hash(executable),
			dependencies,
			cpu: "x64 AVX2, CPU only",
			network: "HTTPS support disabled; application starts local files with --offline",
		},
		null,
		2,
	),
);
console.log("Self-contained offline AI runtime built and Windows DLL imports verified.");
