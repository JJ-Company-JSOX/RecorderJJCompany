// Build-machine only. Customers receive a complete static CPU speech runtime.
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
	await fs.readFile(path.join(root, "scripts/offline-speech.lock.json"), "utf8"),
);
const toolsLock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-ai-build.lock.json"), "utf8"),
);
const destination = path.join(root, "vendor/offline-ai/win32-x64/speech/runtime");
await fs.mkdir(destination, { recursive: true });
async function hash(file) {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(file)) h.update(chunk);
	return h.digest("hex");
}
const built = JSON.parse(
	await fs.readFile(path.join(destination, "BUILD-INFO.json"), "utf8").catch(() => "null"),
);
if (
	built?.staticBuild === 2 &&
	built.revision === lock.sourceRevision &&
	(await hash(path.join(destination, "whisper-cli.exe")).catch(() => "")) === built.sha256
) {
	console.log("Verified existing standalone offline speech runtime");
	process.exit(0);
}
if (process.platform !== "win32" || process.arch !== "x64")
	throw Error("Build offline speech on Windows x64");
const tools = path.join(root, ".tmp/offline-build-tools");
await fs.mkdir(tools, { recursive: true });
const sevenZip = createRequire(import.meta.url)("7zip-bin").path7za;
for (const asset of [toolsLock.llvm, toolsLock.cmake, toolsLock.ninja]) {
	const archive = path.join(tools, asset.file);
	if ((await hash(archive).catch(() => "")) !== asset.sha256) {
		const response = await fetch(asset.url, { signal: AbortSignal.timeout(600000) });
		if (!response.ok || !response.body) throw Error(`Tool download failed: ${response.status}`);
		await pipeline(Readable.fromWeb(response.body), createWriteStream(`${archive}.download`));
		if ((await hash(`${archive}.download`)) !== asset.sha256)
			throw Error("Tool checksum mismatch");
		await fs.rename(`${archive}.download`, archive);
	}
	const executable = asset.directory
		? path.join(
				tools,
				asset.directory,
				"bin",
				asset === toolsLock.llvm ? "x86_64-w64-mingw32-clang.exe" : "cmake.exe",
			)
		: path.join(tools, "ninja.exe");
	if (!(await fs.stat(executable).catch(() => null)))
		execFileSync(sevenZip, ["x", "-y", `-o${tools}`, archive], {
			windowsHide: true,
			stdio: "ignore",
		});
}
const source = path.join(root, ".tmp/offline-whisper-source");
if (!(await fs.stat(path.join(source, ".git")).catch(() => null)))
	execFileSync(
		"git",
		[
			"clone",
			"--depth",
			"1",
			"--branch",
			lock.sourceTag,
			"https://github.com/ggml-org/whisper.cpp.git",
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
	throw Error("Speech source revision mismatch; existing checkout preserved");
try {
	execFileSync("git", ["-C", source, "diff", "--quiet", "HEAD", "--"], {
		windowsHide: true,
		stdio: "ignore",
	});
} catch {
	throw Error("Speech source has tracked changes; existing checkout preserved");
}
const compiler = path.join(tools, toolsLock.llvm.directory, "bin");
const cmake = path.join(tools, toolsLock.cmake.directory, "bin/cmake.exe");
const build = path.join(root, ".tmp/offline-whisper-build");
const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
env[pathKey] = `${compiler}${path.delimiter}${tools}${path.delimiter}${env[pathKey] || ""}`;
const options = { env, windowsHide: true, stdio: "inherit" };
// Upstream common.cpp uses std::partial_sort without including <algorithm>.
// Supply that standard header on the target, preserving the pinned source tree.
const compatibility = path.join(root, ".tmp/offline-whisper-compat.cmake");
await fs.writeFile(
	compatibility,
	'cmake_language(DEFER DIRECTORY "${CMAKE_SOURCE_DIR}" CALL target_compile_options common PRIVATE -include algorithm)\n',
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
		"-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
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
		"-DGGML_CUDA=OFF",
		"-DGGML_VULKAN=OFF",
		"-DWHISPER_CURL=OFF",
		"-DWHISPER_SDL2=OFF",
		"-DWHISPER_BUILD_TESTS=OFF",
		"-DWHISPER_BUILD_SERVER=OFF",
		"-DWHISPER_BUILD_EXAMPLES=ON",
	],
	options,
);
execFileSync(cmake, ["--build", build, "--target", "whisper-cli", "--parallel", "2"], options);
const executable = path.join(build, "bin/whisper-cli.exe");
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
	throw Error(`Unexpected speech runtime DLL dependency: ${dependencies.join(", ")}`);
execFileSync(executable, ["--help"], { windowsHide: true, stdio: "ignore", timeout: 15000 });
await fs.copyFile(executable, path.join(destination, "whisper-cli.exe"));
await fs.copyFile(path.join(source, "LICENSE"), path.join(destination, "WHISPER-LICENSE.txt"));
await fs.copyFile(
	path.join(tools, toolsLock.llvm.directory, "LICENSE.TXT"),
	path.join(destination, "TOOLCHAIN-LICENSE.txt"),
);
const notices = [];
const sgemm = await fs.readFile(path.join(source, "ggml/src/ggml-cpu/llamafile/sgemm.cpp"), "utf8");
const sgemmLicense = sgemm.slice(0, sgemm.indexOf("\n\n"));
if (
	!sgemmLicense.includes("Copyright 2024 Mozilla Foundation") ||
	!sgemmLicense.includes("SOFTWARE.")
)
	throw Error("Missing complete llamafile MIT license");
notices.push(`ggml/src/ggml-cpu/llamafile/sgemm.cpp\n\n${sgemmLicense}`);
for (const [file, marker] of [
	["examples/miniaudio.h", "This software is available as a choice of the following licenses."],
	[
		"examples/stb_vorbis.c",
		"This software is available under 2 licenses -- choose whichever you prefer.",
	],
]) {
	const text = await fs.readFile(path.join(source, file), "utf8"),
		position = text.indexOf(marker),
		start = text.lastIndexOf("/*", position),
		end = text.indexOf("*/", position);
	if (position < 0 || start < 0 || end < position)
		throw Error(`Missing complete embedded license: ${file}`);
	notices.push(`${file}\n\n${text.slice(start, end + 2)}`);
}
for (const file of [
	"COPYING",
	"COPYING.MinGW-w64.txt",
	"COPYING.MinGW-w64-runtime.txt",
	"COPYING.winpthreads.txt",
	"COPYING.winstorecompat.txt",
])
	notices.push(
		`${file}\n\n${await fs.readFile(path.join(tools, toolsLock.llvm.directory, "x86_64-w64-mingw32/share/mingw32", file), "utf8")}`,
	);
await fs.writeFile(path.join(destination, "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n"));
await fs.writeFile(
	path.join(destination, "BUILD-INFO.json"),
	JSON.stringify(
		{
			staticBuild: 2,
			revision: lock.sourceRevision,
			toolchain: toolsLock.llvm.file,
			toolchainSha256: toolsLock.llvm.sha256,
			sha256: await hash(executable),
			dependencies,
			cpu: "x64 AVX2/FMA/F16C/BMI2, CPU only",
			network: "Model download support disabled (WHISPER_CURL=OFF)",
		},
		null,
		2,
	),
);
console.log("Standalone CPU offline speech runtime built; system DLL dependencies verified");
