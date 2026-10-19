import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { parseVadEvidence } from "./vadProtection";

const exec = promisify(execFile);
export function offlineToolsRoot() {
	return app.isPackaged
		? path.join(process.resourcesPath, "offline-tools")
		: path.join(app.getAppPath(), "vendor/offline-tools/win32-x64");
}

async function verifyFiles(root: string, signal?: AbortSignal) {
	const canonical = await fs.realpath(root);
	const manifestPath = await fs.realpath(path.join(canonical, "manifest.json"));
	if (path.dirname(manifestPath) !== canonical || (await fs.stat(manifestPath)).size > 100000)
		throw Error("Invalid offline VAD manifest");
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.files) ||
		!manifest.files.length ||
		manifest.files.length > 128
	)
		throw Error("Missing offline VAD assets");
	const names = new Set<string>();
	for (const file of manifest.files) {
		signal?.throwIfAborted();
		if (
			typeof file.path !== "string" ||
			!/^(?:runtime\/)?[a-zA-Z0-9_.-]+$/.test(file.path) ||
			file.path.includes("..") ||
			names.has(file.path.toLowerCase()) ||
			!Number.isSafeInteger(file.bytes) ||
			file.bytes <= 0 ||
			!/^[a-f0-9]{64}$/.test(file.sha256)
		)
			throw Error("Invalid offline VAD asset entry");
		names.add(file.path.toLowerCase());
		const target = await fs.realpath(path.join(canonical, file.path));
		const relative = path.relative(canonical, target);
		const stat = await fs.stat(target);
		if (
			relative.startsWith("..") ||
			path.isAbsolute(relative) ||
			!stat.isFile() ||
			stat.size !== file.bytes
		)
			throw Error("Offline VAD asset missing or corrupt");
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(target, { signal })) hash.update(chunk);
		if (hash.digest("hex") !== file.sha256) throw Error("Offline VAD checksum mismatch");
	}
	signal?.throwIfAborted();
	return names;
}

export async function detectBundledVoiceActivity(wavPath: string, signal?: AbortSignal) {
	signal?.throwIfAborted();
	const root = offlineToolsRoot();
	const vad = path.join(root, "silero"),
		sherpa = path.join(root, "sherpa");
	const names = await verifyFiles(vad, signal);
	if (!names.has("silero_vad_16k_op15.onnx") || !names.has("runtime/jsox-vad.exe"))
		throw Error("Complete offline VAD is not installed");
	const runtimeNames = await verifyFiles(sherpa, signal);
	if (!runtimeNames.has("runtime/sherpa-onnx-c-api.dll"))
		throw Error("Shared offline speech runtime missing");
	const { stdout } = await exec(
		path.join(vad, "runtime/jsox-vad.exe"),
		[
			path.join(vad, "silero_vad_16k_op15.onnx"),
			wavPath,
			path.join(sherpa, "runtime/sherpa-onnx-c-api.dll"),
		],
		{ signal, windowsHide: true, timeout: 5 * 60_000, maxBuffer: 2_000_000 },
	);
	signal?.throwIfAborted();
	return parseVadEvidence(stdout);
}
