// Build-machine only. Installed applications never run this downloader/compiler.
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
	await fs.readFile(path.join(root, "scripts/offline-speech.lock.json"), "utf8"),
);
const directory = path.join(root, "vendor/offline-ai/win32-x64/speech");
const verifyOnly = process.argv.includes("--verify");
await fs.mkdir(directory, { recursive: true });
async function hash(file) {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(file)) h.update(chunk);
	return h.digest("hex");
}
async function verified(file, size, sha256) {
	return (await fs.stat(file).catch(() => null))?.size === size && (await hash(file)) === sha256;
}
const artifact = lock.artifact,
	model = path.join(directory, artifact.file);
if (!(await verified(model, artifact.size, artifact.sha256))) {
	if (verifyOnly)
		throw Error(
			"Complete offline speech model missing or corrupt; prepare on the build machine",
		);
	const temporary = `${model}.download`;
	for (let attempt = 0; attempt < 4; attempt++) {
		let offset = (await fs.stat(temporary).catch(() => null))?.size ?? 0;
		if (offset >= artifact.size) {
			if (await verified(temporary, artifact.size, artifact.sha256)) break;
			offset = 0;
		}
		try {
			console.log(
				`Downloading official multilingual speech model from ${offset}/${artifact.size} bytes`,
			);
			const response = await fetch(artifact.url, {
				headers: offset ? { Range: `bytes=${offset}-` } : {},
				signal: AbortSignal.timeout(600000),
			});
			if (!response.ok || !response.body)
				throw Error(`Model download failed: ${response.status}`);
			if (
				response.status === 206 &&
				!response.headers.get("content-range")?.startsWith(`bytes ${offset}-`)
			)
				throw Error("Invalid resumed speech response");
			if (response.status !== 206) offset = 0;
			await pipeline(
				Readable.fromWeb(response.body),
				createWriteStream(temporary, { flags: offset ? "a" : "w" }),
			);
			break;
		} catch (error) {
			if (attempt === 3) throw error;
		}
	}
	if (!(await verified(temporary, artifact.size, artifact.sha256)))
		throw Error("Speech model checksum mismatch");
	await fs.rename(temporary, model);
}
if (!verifyOnly) {
	execFileSync(process.execPath, [path.join(root, "scripts/build-offline-whisper-runtime.mjs")], {
		windowsHide: true,
		stdio: "inherit",
	});
	const license = await fetch(lock.modelLicenseUrl, { signal: AbortSignal.timeout(60000) });
	if (!license.ok) throw Error(`Model license download failed: ${license.status}`);
	await fs.writeFile(path.join(directory, "MODEL-LICENSE.txt"), await license.text());
	await fs.writeFile(
		path.join(directory, "NOTICE.txt"),
		`Jsox offline speech\nModel: ${lock.modelName}\nModel license: MIT\nConverted and quantized for whisper.cpp\nModel revision: ${lock.modelRevision}\nhttps://huggingface.co/ggerganov/whisper.cpp\nSource: whisper.cpp ${lock.sourceTag} ${lock.sourceRevision}\nhttps://github.com/ggml-org/whisper.cpp\n`,
	);
	const files = [];
	for (const name of [
		artifact.file,
		"MODEL-LICENSE.txt",
		"NOTICE.txt",
		...(await fs.readdir(path.join(directory, "runtime"))).map((name) => `runtime/${name}`),
	]) {
		const file = path.join(directory, name),
			info = await fs.stat(file);
		if (!info.isFile()) throw Error(`Unexpected nested speech runtime asset: ${name}`);
		files.push({ path: name, bytes: info.size, sha256: await hash(file) });
	}
	await fs.writeFile(
		path.join(directory, "manifest.json"),
		JSON.stringify({ version: 1, modelName: lock.modelName, files }, null, 2),
	);
}
const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
const required = [
	artifact.file,
	"MODEL-LICENSE.txt",
	"NOTICE.txt",
	"runtime/whisper-cli.exe",
	"runtime/BUILD-INFO.json",
	"runtime/WHISPER-LICENSE.txt",
	"runtime/TOOLCHAIN-LICENSE.txt",
	"runtime/THIRD-PARTY-NOTICES.txt",
];
if (
	manifest.version !== 1 ||
	!Array.isArray(manifest.files) ||
	required.some((name) => !manifest.files.some((file) => file.path === name))
)
	throw Error("Complete speech runtime/license manifest missing");
for (const file of manifest.files) {
	if (
		!/^(?:ggml-small-q5_1\.bin|MODEL-LICENSE\.txt|NOTICE\.txt|runtime\/[a-zA-Z0-9_.-]+)$/.test(
			file.path,
		) ||
		!Number.isSafeInteger(file.bytes) ||
		file.bytes <= 0 ||
		!/^[a-f0-9]{64}$/.test(file.sha256) ||
		!(await verified(path.join(directory, file.path), file.bytes, file.sha256))
	)
		throw Error(`Speech asset invalid or corrupt: ${file.path}`);
}
console.log(
	`Complete offline speech bundle verified: ${manifest.files.length} assets, no customer setup`,
);
