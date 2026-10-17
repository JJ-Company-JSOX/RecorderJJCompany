import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyNativeHelperManifest } from "./native-helper-manifest.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archTag = "win32-x64";
const bundledDir = path.join(projectRoot, "electron", "native", "bin", archTag);
const helpers = [
	["wgc-capture", "wgc-capture", "wgc-capture.exe"],
	["cursor-monitor", "cursor-monitor", "cursor-monitor.exe"],
	["recordly-gpu-export", "gpu-export-probe", "recordly-gpu-export.exe"],
	[
		"recordly-nvidia-cuda-compositor",
		"nvidia-cuda-compositor",
		"recordly-nvidia-cuda-compositor.exe",
	],
];
// The CLI runtime is small and contains no AI model. Keep its DLL dependencies.
const runtimeFiles = [
	"whisper-cli.exe",
	"whisper-runtime.json",
	"whisper.dll",
	"ggml.dll",
	"ggml-base.dll",
	"ggml-cpu.dll",
	"SDL2.dll",
];

function assertFile(filePath) {
	if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
		throw new Error(`Required prebuilt file missing: ${filePath}`);
	}
}

function assertX64Pe(filePath) {
	assertFile(filePath);
	const data = readFileSync(filePath);
	const peOffset = data.length >= 64 ? data.readUInt32LE(0x3c) : data.length;
	if (
		data.toString("ascii", 0, 2) !== "MZ" ||
		peOffset + 6 > data.length ||
		data.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0" ||
		data.readUInt16LE(peOffset + 4) !== 0x8664
	) {
		throw new Error(`Expected a Windows x64 PE binary: ${filePath}`);
	}
}

function verifyHelpers(directory) {
	const manifestPath = path.join(directory, "helpers-manifest.json");
	assertFile(manifestPath);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (manifest.platform !== "win32" || manifest.arch !== "x64") {
		throw new Error(`Expected win32/x64 helper manifest: ${manifestPath}`);
	}
	for (const [helperId, sourceName, binaryName] of helpers) {
		const binaryPath = path.join(directory, binaryName);
		assertX64Pe(binaryPath);
		// Reuse the project's verifier with the candidate manifest; it checks both
		// the binary SHA-256 and the source fingerprint in this checkout.
		const sourceRoot = path.resolve(directory, "../../../..");
		if (
			path.resolve(directory) !== path.join(sourceRoot, "electron", "native", "bin", archTag)
		) {
			throw new Error(
				"--helpers-from must point to a checkout's electron/native/bin/win32-x64 directory.",
			);
		}
		const result = verifyNativeHelperManifest({
			projectRoot: sourceRoot,
			helperId,
			sourceDir: path.join(projectRoot, "electron", "native", sourceName),
			binaryPath,
			binaryName,
			platform: "win32",
			arch: "x64",
		});
		const integrityFailures = result.reasons.filter(
			(reason) => reason !== "source fingerprint mismatch",
		);
		if (integrityFailures.length > 0) {
			throw new Error(
				`${binaryName} cannot be reused: ${result.reasons.join(", ")}. Rebuild it from this checkout.`,
			);
		}
		if (!result.ok) {
			console.warn(
				`[windows-test] WARNING: ${binaryName} matches its binary SHA-256, but its source fingerprint is stale. This test package reuses the existing binary; it does not verify a rebuild from current sources.`,
			);
		}
	}
	for (const name of runtimeFiles) {
		const filePath = path.join(directory, name);
		assertFile(filePath);
		if (name.endsWith(".exe") || name.endsWith(".dll")) assertX64Pe(filePath);
	}
	const runtime = JSON.parse(readFileSync(path.join(directory, "whisper-runtime.json"), "utf8"));
	if (
		runtime.platform !== "win32" ||
		runtime.arch !== "x64" ||
		runtime.binary !== "whisper-cli.exe"
	) {
		throw new Error("Whisper runtime manifest must describe win32/x64 whisper-cli.exe.");
	}
}

if (process.platform !== "win32" || process.arch !== "x64") {
	throw new Error("The local Windows test package requires a Windows x64 host.");
}

const args = process.argv.slice(2);
let helpersFrom;
let helpersOnly = false;
for (let index = 0; index < args.length; index += 1) {
	if (args[index] === "--helpers-from" && args[index + 1]) {
		helpersFrom = path.resolve(args[++index]);
	} else if (args[index] === "--helpers-only") {
		helpersOnly = true;
	} else {
		throw new Error(
			`Unknown argument: ${args[index]}. Use --helpers-from <directory> and/or --helpers-only.`,
		);
	}
}

if (helpersFrom) {
	verifyHelpers(helpersFrom);
	if (helpersFrom !== bundledDir) {
		mkdirSync(bundledDir, { recursive: true });
		for (const name of [
			"helpers-manifest.json",
			...helpers.map((helper) => helper[2]),
			...runtimeFiles,
		]) {
			copyFileSync(path.join(helpersFrom, name), path.join(bundledDir, name));
		}
	}
	console.log(
		"[windows-test] Staged verified native helpers and existing CLI runtime (no models).",
	);
}

verifyHelpers(bundledDir);
console.log(
	"[windows-test] Native helper binary hashes and Windows x64 architecture passed; review any source provenance warnings above.",
);
if (!helpersOnly) {
	for (const name of [
		"dist/index.html",
		"dist-electron/main.cjs",
		"dist-electron/preload.mjs",
		"node_modules/electron/dist/electron.exe",
		"node_modules/ffmpeg-static/ffmpeg.exe",
		"node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe",
	]) {
		assertFile(path.join(projectRoot, name));
	}
	assertX64Pe(path.join(projectRoot, "node_modules/electron/dist/electron.exe"));
	const hookPath = path.join(
		projectRoot,
		"node_modules/uiohook-napi/prebuilds/win32-x64/node.napi.node",
	);
	assertX64Pe(hookPath);
	console.log(
		"[windows-test] Built app, Electron runtime, FFmpeg, FFprobe and prebuilt cursor hook are ready.",
	);
}
