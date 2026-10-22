// Build-machine only. Installed applications never fetch a model or an npm package.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-tts.lock.json"), "utf8"),
);
const verifyOnly = process.argv.includes("--verify");
// The older single-language VITS voices are only a fallback for developer folders and
// packages built before Kokoro; new packages ship Kokoro alone.
const withLegacy = process.argv.includes("--legacy-vits");
const vendor = path.join(root, "vendor/offline-ai/win32-x64");
const temporary = path.join(root, ".tmp/offline-tts");

async function hash(file) {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(file)) h.update(chunk);
	return h.digest("hex");
}
async function valid(file, entry) {
	const stat = await fs.lstat(file).catch(() => null);
	return !!stat?.isFile() && stat.size === entry.size && (await hash(file)) === entry.sha256;
}
/** Size-capped, resumable download with retries; the result must match the pinned SHA-256. */
async function download(entry, file) {
	if (await valid(file, entry)) return;
	await fs.mkdir(path.dirname(file), { recursive: true });
	const partial = `${file}.download`;
	for (let attempt = 0; attempt < 4; attempt++) {
		const controller = new AbortController();
		let lastProgress = Date.now();
		const watchdog = setInterval(() => {
			if (Date.now() - lastProgress > 60000) controller.abort(Error("Download stalled"));
		}, 5000);
		try {
			let offset = (await fs.stat(partial).catch(() => null))?.size ?? 0;
			if (offset >= entry.size) {
				if (await valid(partial, entry)) break;
				offset = 0;
			}
			console.log(
				`Preparing pinned TTS asset: ${path.basename(file)}${offset ? ` (resuming at ${offset} bytes)` : ""}`,
			);
			const response = await fetch(entry.url, {
				headers: offset ? { Range: `bytes=${offset}-` } : {},
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60 * 60 * 1000)]),
			});
			if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
			if (response.status === 206) {
				if (!response.headers.get("content-range")?.startsWith(`bytes ${offset}-`))
					throw new Error("Invalid resumed response");
			} else offset = 0;
			let received = offset;
			let announced = offset;
			const limiter = new Transform({
				transform(chunk, _encoding, done) {
					lastProgress = Date.now();
					received += chunk.length;
					if (received > entry.size) return done(new Error("Oversized asset response"));
					if (received - announced > 64 * 1024 ** 2) {
						announced = received;
						console.log(
							`${path.basename(file)}: ${Math.floor((received / entry.size) * 100)}%`,
						);
					}
					done(null, chunk);
				},
			});
			await pipeline(
				Readable.fromWeb(response.body),
				limiter,
				createWriteStream(partial, { flags: offset ? "a" : "w" }),
			);
			break;
		} catch (error) {
			// An oversized or wrong file is not resumed from.
			if (error instanceof Error && error.message === "Oversized asset response")
				await fs.rm(partial, { force: true });
			if (attempt === 3) throw error;
			console.log(`Retrying ${path.basename(file)} (${attempt + 1}/3)`);
		} finally {
			clearInterval(watchdog);
		}
	}
	if (!(await valid(partial, entry))) {
		await fs.rm(partial, { force: true });
		throw new Error(`Checksum mismatch: ${path.basename(file)}`);
	}
	await fs.rename(partial, file);
}
async function fetchText(entry) {
	const response = await fetch(entry.url, { signal: AbortSignal.timeout(60000) });
	if (!response.ok) throw new Error(`License download failed: ${response.status} ${entry.url}`);
	const text = await response.text();
	if (entry.sha256 && createHash("sha256").update(text).digest("hex") !== entry.sha256)
		throw new Error(`License checksum mismatch: ${entry.url}`);
	return text;
}
/** Windows 10/11 ship bsdtar as System32\tar.exe; it reads .tar.bz2. Git's tar may not. */
function tar() {
	if (process.platform !== "win32") return "tar";
	return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
}
function extract(archive, destination) {
	try {
		execFileSync(tar(), ["-xf", archive, "-C", destination], {
			windowsHide: true,
			stdio: ["ignore", "ignore", "pipe"],
		});
	} catch (error) {
		throw new Error(
			`Could not extract ${path.basename(archive)} with ${tar()}. Windows 10/11 include tar.exe in System32; on Linux or macOS install tar with bzip2 support. ${error instanceof Error ? error.message : ""}`,
		);
	}
}

/** Mirrors the app: plain top-level names, or safe parts inside a listed folder. */
const SAFE_NAME = /^[A-Za-z0-9_!+-](?:[A-Za-z0-9_.!+ -]*[A-Za-z0-9_!+-])?$/;
const safePath = (file, folders) =>
	/^[A-Za-z0-9_.-]+$/.test(file) && !file.includes("..")
		? true
		: file.includes("/") &&
			folders.includes(file.split("/")[0]) &&
			file.split("/").every((part) => SAFE_NAME.test(part));
/** Written by this script next to the pinned files. */
const GENERATED = ["MODEL-LICENSE.txt", "NOTICE.txt"];
/**
 * Every file in the voice folder must be one the lock or this script put there: the offline
 * package ships the whole folder, so a leftover would ship unverified.
 */
async function refuseUnexpected(directory, expected) {
	for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
		if (entry.isDirectory()) continue;
		const relative = path
			.relative(directory, path.join(entry.parentPath ?? entry.path, entry.name))
			.split(path.sep)
			.join("/");
		if (!expected.has(relative))
			throw new Error(
				`Unexpected file in ${path.basename(directory)}: ${relative}. Remove it and prepare again.`,
			);
	}
}
/** The folder holds exactly the pinned files (as pinned) plus the generated ones, nothing else. */
async function verify(directory, artifacts, folders = []) {
	const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
	const required = [...artifacts.map((artifact) => artifact.file), ...GENERATED];
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.files) ||
		manifest.files.length !== required.length ||
		required.some((file) => !manifest.files.some((entry) => entry?.path === file))
	)
		throw new Error(
			`Offline TTS manifest does not match scripts/offline-tts.lock.json: ${directory}`,
		);
	const seen = new Set();
	for (const entry of manifest.files) {
		const pinned = artifacts.find((artifact) => artifact.file === entry.path);
		if (
			typeof entry.path !== "string" ||
			!safePath(entry.path, folders) ||
			seen.has(entry.path.toLowerCase()) ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes < 1 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256) ||
			(pinned && (pinned.size !== entry.bytes || pinned.sha256 !== entry.sha256)) ||
			!(await valid(path.join(directory, ...entry.path.split("/")), {
				size: entry.bytes,
				sha256: entry.sha256,
			}))
		)
			throw new Error(`Invalid offline TTS asset: ${entry.path}`);
		seen.add(entry.path.toLowerCase());
	}
	await refuseUnexpected(directory, new Set([...required, "manifest.json"]));
}
async function writeManifest(directory, modelName, names) {
	const files = [];
	for (const name of names) {
		const file = path.join(directory, ...name.split("/"));
		files.push({ path: name, bytes: (await fs.stat(file)).size, sha256: await hash(file) });
	}
	await fs.writeFile(
		path.join(directory, "manifest.json"),
		JSON.stringify({ version: 1, modelName, files }, null, 2),
	);
}
const notice = (voice, label, extra = "") =>
	`Jsox offline narration speech synthesis (${label})\nModel: ${voice.modelName}\nModel license: ${voice.modelLicense}\nSource: ${voice.modelSource}\n${extra}Synthesis engine: sherpa-onnx ${lock.runtimeVersion} (Apache-2.0), https://github.com/k2-fsa/sherpa-onnx\nNode bindings: ${lock.npm.sherpaOnnxNode}, prebuilt native addon: ${lock.npm.sherpaOnnxWinX64}\nNo Python, Ollama, or network service is used by installed customers.\n`;

/** One release archive, verified, unpacked, and only the files the voice needs copied out. */
async function prepareArchiveVoice(name, voice) {
	const directory = path.join(vendor, voice.directory);
	const folders = voice.folders ?? [];
	const required = [...voice.artifacts.map((a) => a.file), ...GENERATED];
	if (verifyOnly) return verify(directory, voice.artifacts, folders);
	const target = (artifact) => path.join(directory, ...artifact.file.split("/"));
	const missing = [];
	for (const artifact of voice.artifacts)
		if (!(await valid(target(artifact), artifact))) missing.push(artifact);
	if (missing.length) {
		const archive = path.join(temporary, path.basename(new URL(voice.archive.url).pathname));
		await download(voice.archive, archive);
		const unpacked = path.join(temporary, `${name}-unpacked`);
		await fs.rm(unpacked, { recursive: true, force: true });
		await fs.mkdir(unpacked, { recursive: true });
		console.log(`Extracting ${path.basename(archive)}`);
		extract(archive, unpacked);
		for (const artifact of missing) {
			const source = path.join(unpacked, voice.archive.root, ...artifact.file.split("/"));
			if (!(await valid(source, artifact)))
				throw new Error(`Archive file missing or not as pinned: ${artifact.file}`);
			await fs.mkdir(path.dirname(target(artifact)), { recursive: true });
			await fs.copyFile(source, target(artifact));
		}
		await fs.rm(unpacked, { recursive: true, force: true });
	}
	for (const artifact of voice.artifacts)
		if (!(await valid(target(artifact), artifact)))
			throw new Error(`Invalid offline TTS asset: ${artifact.file}`);
	await refuseUnexpected(directory, new Set([...required, "manifest.json"]));
	const licenses = [];
	for (const license of voice.licenses)
		licenses.push(
			`===== ${license.title} =====\n${license.url}\n\n${await fetchText(license)}`,
		);
	await fs.writeFile(
		path.join(directory, "MODEL-LICENSE.txt"),
		`${voice.licenseSummary.join("\n")}\n\n${licenses.join("\n\n")}`,
	);
	await fs.writeFile(
		path.join(directory, "NOTICE.txt"),
		notice(
			voice,
			voice.languages.join(", "),
			`Archive: ${voice.archive.url}\nArchive SHA-256: ${voice.archive.sha256}\nConversion scripts: ${voice.converter}\n`,
		),
	);
	await writeManifest(directory, voice.modelName, required);
	await verify(directory, voice.artifacts, folders);
}

/** The older voices: one pinned download per file. */
async function prepareFileVoice(language, voice) {
	const directory = path.join(vendor, voice.directory);
	const required = [...voice.artifacts.map((a) => a.file), ...GENERATED];
	if (verifyOnly) return verify(directory, voice.artifacts);
	await fs.mkdir(directory, { recursive: true });
	for (const entry of voice.artifacts) await download(entry, path.join(directory, entry.file));
	await fs.writeFile(
		path.join(directory, "MODEL-LICENSE.txt"),
		await fetchText({ url: voice.modelLicenseUrl, sha256: voice.modelLicenseSha256 }),
	);
	await fs.writeFile(
		path.join(directory, "NOTICE.txt"),
		notice(voice, language, `Revision: ${voice.modelRevision}\n`),
	);
	await writeManifest(directory, voice.modelName, required);
	await verify(directory, voice.artifacts);
}

for (const [name, voice] of Object.entries(lock.voices)) await prepareArchiveVoice(name, voice);
if (withLegacy)
	for (const [language, voice] of Object.entries(lock.legacyVoices))
		await prepareFileVoice(language, voice);
console.log(
	verifyOnly
		? "Pinned offline TTS voices verified; no network used"
		: "Offline narration TTS voices ready",
);
