// Build-machine only. Installed applications never fetch a model or an npm package.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await fs.readFile(path.join(root, "scripts/offline-tts.lock.json"), "utf8"));
const directory = path.join(root, "vendor/offline-ai/win32-x64/tts");
const verifyOnly = process.argv.includes("--verify");
async function hash(file) {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(file)) h.update(chunk);
	return h.digest("hex");
}
async function valid(file, entry) {
	return (
		(await fs.stat(file).catch(() => null))?.size === entry.size &&
		(await hash(file)) === entry.sha256
	);
}
async function download(entry, file) {
	if (await valid(file, entry)) return;
	await fs.mkdir(path.dirname(file), { recursive: true });
	const partial = `${file}.download`;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			console.log(`Preparing pinned TTS asset: ${path.basename(file)}`);
			const response = await fetch(entry.url, { signal: AbortSignal.timeout(600000) });
			if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
			let received = 0;
			const limiter = async function* (source) {
				for await (const chunk of source) {
					received += chunk.length;
					if (received > entry.size) throw new Error("Oversized asset response");
					yield chunk;
				}
			};
			await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(partial));
			if (!(await valid(partial, entry))) throw new Error(`Checksum mismatch: ${path.basename(file)}`);
			await fs.rename(partial, file);
			return;
		} catch (error) {
			if (attempt === 2) throw error;
		}
	}
}
const required = [...lock.artifacts.map((a) => a.file), "MODEL-LICENSE.txt", "NOTICE.txt"];
async function verify() {
	const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.files) ||
		required.some((file) => !manifest.files.some((entry) => entry.path === file))
	)
		throw new Error("Incomplete offline TTS manifest");
	const seen = new Set();
	for (const entry of manifest.files) {
		if (
			!/^[A-Za-z0-9_.-]+$/.test(entry.path) ||
			entry.path.includes("..") ||
			seen.has(entry.path.toLowerCase()) ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes < 1 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256) ||
			!(await valid(path.join(directory, entry.path), { size: entry.bytes, sha256: entry.sha256 }))
		)
			throw new Error(`Invalid offline TTS asset: ${entry.path}`);
		seen.add(entry.path.toLowerCase());
	}
	return manifest;
}
if (verifyOnly) {
	await verify();
	console.log("Pinned offline TTS bundle verified; no network used");
	process.exit(0);
}
await fs.mkdir(directory, { recursive: true });
for (const entry of lock.artifacts) await download(entry, path.join(directory, entry.file));
const license = await fetch(lock.modelLicenseUrl, { signal: AbortSignal.timeout(60000) });
if (!license.ok) throw new Error(`Model license download failed: ${license.status}`);
await fs.writeFile(path.join(directory, "MODEL-LICENSE.txt"), await license.text());
await fs.writeFile(
	path.join(directory, "NOTICE.txt"),
	`Jsox offline narration speech synthesis\nModel: ${lock.modelName}\nModel license: ${lock.modelLicense}\nSource: ${lock.modelSource}\nRevision: ${lock.modelRevision}\nSynthesis engine: sherpa-onnx ${lock.runtimeVersion} (Apache-2.0), https://github.com/k2-fsa/sherpa-onnx\nNode bindings: ${lock.npm.sherpaOnnxNode}, prebuilt native addon: ${lock.npm.sherpaOnnxWinX64}\nNo Python, Ollama, or network service is used by installed customers.\n`,
);
const files = [];
for (const name of required) {
	const file = path.join(directory, name);
	files.push({ path: name, bytes: (await fs.stat(file)).size, sha256: await hash(file) });
}
await fs.writeFile(
	path.join(directory, "manifest.json"),
	JSON.stringify({ version: 1, modelName: lock.modelName, files }, null, 2),
);
await verify();
console.log("Offline narration TTS bundle ready");
