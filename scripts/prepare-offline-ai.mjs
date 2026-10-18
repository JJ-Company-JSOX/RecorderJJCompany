// Build-machine tool only. The installed application never downloads models.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await fs.readFile(path.join(root, "scripts/offline-ai.lock.json"), "utf8"));
const destination = path.join(root, "vendor/offline-ai/win32-x64");
const verifyOnly = process.argv.includes("--verify");
await fs.mkdir(destination, { recursive: true });
async function hash(file) {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(file)) h.update(chunk);
	return h.digest("hex");
}
async function verified(file, size, sha256) {
	return (await fs.stat(file).catch(() => null))?.size === size && (await hash(file)) === sha256;
}
for (const artifact of lock.artifacts) {
	const file = path.join(destination, artifact.file);
	if (await verified(file, artifact.size, artifact.sha256)) {
		console.log(`Verified ${artifact.file}`);
		continue;
	}
	if (verifyOnly)
		throw Error(
			`Offline AI build asset missing or corrupt: ${artifact.file}. Run npm run prepare:offline-ai on the build machine.`,
		);
	console.log(
		`Downloading official build asset ${artifact.file} (${(artifact.size / 1e9).toFixed(2)} GB)`,
	);
	const temporary = `${file}.download`;
	for (let attempt = 0; attempt < 4; attempt++) {
		const controller = new AbortController();
		let lastProgress = Date.now();
		const watchdog = setInterval(() => {
			if (Date.now() - lastProgress > 60000)
				controller.abort(Error("Download stalled; resuming"));
		}, 5000);
		try {
			let offset = (await fs.stat(temporary).catch(() => null))?.size ?? 0;
			if (offset >= artifact.size) {
				if (await verified(temporary, artifact.size, artifact.sha256)) break;
				offset = 0;
			}
			const response = await fetch(artifact.url, {
				headers: offset ? { Range: `bytes=${offset}-` } : {},
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60 * 60 * 1000)]),
			});
			if (!response.ok || !response.body)
				throw Error(`Download failed: HTTP ${response.status}`);
			if (response.status === 206) {
				if (!response.headers.get("content-range")?.startsWith(`bytes ${offset}-`))
					throw Error("Invalid resumed response");
			} else offset = 0;
			let received = offset,
				announced = offset;
			const progress = new Transform({
				transform(chunk, _encoding, done) {
					lastProgress = Date.now();
					received += chunk.length;
					if (received - announced > 64 * 1024 ** 2) {
						announced = received;
						console.log(
							`${artifact.file}: ${Math.floor((received / artifact.size) * 100)}%`,
						);
					}
					done(null, chunk);
				},
			});
			await pipeline(
				Readable.fromWeb(response.body),
				progress,
				createWriteStream(temporary, { flags: offset ? "a" : "w" }),
			);
			break;
		} catch (error) {
			if (attempt === 3) throw error;
			console.log(`Retrying ${artifact.file} from its partial download (${attempt + 1}/3)`);
		} finally {
			clearInterval(watchdog);
		}
	}
	if (!(await verified(temporary, artifact.size, artifact.sha256)))
		throw Error(`Integrity check failed: ${artifact.file}`);
	await fs.rename(temporary, file);
}
const runtime = path.join(destination, "runtime-static");
if (!verifyOnly) {
	execFileSync(process.execPath, [path.join(root, "scripts/build-offline-ai-runtime.mjs")], {
		windowsHide: true,
		stdio: "inherit",
	});
	const modelLicense = await fetch(
		"https://raw.githubusercontent.com/QwenLM/Qwen3-VL/96588727e44c78b25ba03ea03b8e12f7e64fd0da/LICENSE",
	);
	if (!modelLicense.ok) throw Error("Could not retrieve the model license");
	await fs.writeFile(path.join(destination, "MODEL-LICENSE.txt"), await modelLicense.text());
	await fs.writeFile(
		path.join(destination, "NOTICE.txt"),
		`Jsox offline AI\nModel: ${lock.modelName}\nModel license: Apache-2.0\nModel revision: ${lock.modelRevision}\nhttps://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF\nRuntime: llama.cpp, MIT\nRuntime revision: ${lock.runtimeRevision}\nhttps://github.com/ggml-org/llama.cpp\nQuantized weights are provided by Qwen.\n`,
	);
	const entries = await fs.readdir(runtime);
	const files = [];
	for (const name of [
		"model.gguf",
		"vision.gguf",
		"MODEL-LICENSE.txt",
		"NOTICE.txt",
		...entries.map((name) => `runtime-static/${name}`),
	]) {
		const file = path.join(destination, name),
			stat = await fs.stat(file);
		if (!stat.isFile()) throw Error(`Unexpected nested runtime asset: ${name}`);
		files.push({ file: name, size: stat.size, sha256: await hash(file) });
	}
	if (!entries.includes("llama-server.exe"))
		throw Error("The runtime archive does not include llama-server.exe");
	await fs.writeFile(
		path.join(destination, "manifest.json"),
		JSON.stringify(
			{ version: 1, modelName: lock.modelName, modelLicense: lock.modelLicense, files },
			null,
			2,
		),
	);
}
const manifest = JSON.parse(await fs.readFile(path.join(destination, "manifest.json"), "utf8"));
const requiredFiles = [
	"model.gguf",
	"vision.gguf",
	"MODEL-LICENSE.txt",
	"NOTICE.txt",
	"runtime-static/llama-server.exe",
	"runtime-static/BUILD-INFO.json",
	"runtime-static/LLAMA-LICENSE.txt",
	"runtime-static/TOOLCHAIN-LICENSE.txt",
	"runtime-static/THIRD-PARTY-NOTICES.txt",
];
if (
	manifest.version !== 1 ||
	!Array.isArray(manifest.files) ||
	requiredFiles.some((name) => !manifest.files.some((entry) => entry.file === name))
)
	throw Error("The complete offline AI manifest is missing required assets or licenses");
for (const entry of manifest.files) {
	if (
		path.isAbsolute(entry.file) ||
		entry.file.includes("..") ||
		!(await verified(path.join(destination, entry.file), entry.size, entry.sha256))
	)
		throw Error(`Invalid offline AI asset: ${entry.file}`);
}
console.log(
	`Offline AI bundle verified: ${manifest.files.length} assets. No customer setup is required.`,
);
