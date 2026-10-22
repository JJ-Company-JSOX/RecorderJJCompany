// Build-machine only. Installed applications never download a model or an npm package.
// The OCR bundle is ONNX models plus the onnxruntime-web WASM runtime, so it can be
// prepared on any OS; the result is packaged into the Windows offline edition.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-ocr.lock.json"), "utf8"),
);
const destination = path.join(root, "vendor/offline-ai/win32-x64", lock.directory);
const cache = path.join(root, ".tmp/ocr-downloads");
const verifyOnly = process.argv.includes("--verify");
const locked = [
	...lock.wheel.files,
	{ file: lock.dictionary.file, size: lock.dictionary.size, sha256: lock.dictionary.sha256 },
	...lock.runtime.files,
];
const required = [...locked.map((entry) => entry.file), "NOTICE.txt"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
function checked(bytes, entry) {
	if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256)
		throw new Error(`Checksum mismatch: ${entry.file}`);
	return bytes;
}

/** Streams a pinned download into `file`, refusing anything larger than the locked size. */
async function download(entry, file) {
	if (await valid(file, entry)) return;
	await fs.mkdir(path.dirname(file), { recursive: true });
	const partial = `${file}.download`;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			console.log(`Downloading pinned OCR asset: ${path.basename(file)}`);
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
			if (!(await valid(partial, entry)))
				throw new Error(`Checksum mismatch: ${path.basename(file)}`);
			await fs.rename(partial, file);
			return;
		} catch (error) {
			await fs.rm(partial, { force: true });
			if (attempt === 2) throw error;
			console.log(`Retrying ${path.basename(file)} (${attempt + 1}/2): ${error.message}`);
		}
	}
}

/** Central directory of a (non-ZIP64) wheel; enough for a pinned PyPI archive. */
function zipEntries(archive) {
	let end = -1;
	for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65557); i--)
		if (archive.readUInt32LE(i) === 0x06054b50) {
			end = i;
			break;
		}
	if (end < 0) throw new Error("The pinned wheel is not a ZIP archive");
	const entries = new Map();
	let offset = archive.readUInt32LE(end + 16);
	for (let n = archive.readUInt16LE(end + 10); n > 0; n--) {
		if (archive.readUInt32LE(offset) !== 0x02014b50)
			throw new Error("Corrupt wheel central directory");
		const nameLength = archive.readUInt16LE(offset + 28);
		entries.set(archive.toString("utf8", offset + 46, offset + 46 + nameLength), {
			method: archive.readUInt16LE(offset + 10),
			compressedSize: archive.readUInt32LE(offset + 20),
			size: archive.readUInt32LE(offset + 24),
			local: archive.readUInt32LE(offset + 42),
		});
		offset +=
			46 + nameLength + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
	}
	return entries;
}

function unzip(archive, entries, entry) {
	const record = entries.get(entry.wheelPath);
	if (!record || record.size !== entry.size)
		throw new Error(`The pinned wheel does not contain ${entry.wheelPath}`);
	if (archive.readUInt32LE(record.local) !== 0x04034b50)
		throw new Error(`Corrupt wheel entry: ${entry.wheelPath}`);
	const start =
		record.local +
		30 +
		archive.readUInt16LE(record.local + 26) +
		archive.readUInt16LE(record.local + 28);
	const data = archive.subarray(start, start + record.compressedSize);
	if (record.method === 0) return checked(Buffer.from(data), entry);
	if (record.method !== 8) throw new Error(`Unsupported compression in ${entry.wheelPath}`);
	return checked(inflateRawSync(data, { maxOutputLength: entry.size }), entry);
}

/** Reads one ModelProto.metadata_props (field 14) value from an ONNX protobuf. */
function onnxMetadata(model, key) {
	const varint = (state) => {
		let value = 0;
		let scale = 1;
		for (;;) {
			const byte = model[state.offset++];
			value += (byte & 0x7f) * scale;
			if (!(byte & 0x80)) return value;
			scale *= 128;
		}
	};
	const fields = (start, end, visit) => {
		const state = { offset: start };
		while (state.offset < end) {
			const tag = varint(state);
			const wire = tag % 8;
			if (wire === 0) varint(state);
			else if (wire === 1) state.offset += 8;
			else if (wire === 5) state.offset += 4;
			else if (wire === 2) {
				const length = varint(state);
				visit(Math.floor(tag / 8), state.offset, state.offset + length);
				state.offset += length;
			} else throw new Error(`Unexpected protobuf wire type ${wire}`);
			if (state.offset > end) throw new Error("Truncated ONNX model");
		}
	};
	let found = null;
	fields(0, model.length, (field, start, end) => {
		if (field !== 14) return;
		const entry = {};
		fields(start, end, (inner, from, to) => {
			if (inner === 1) entry.key = model.toString("utf8", from, to);
			if (inner === 2) entry.value = model.subarray(from, to);
		});
		if (entry.key === key) found = Buffer.from(entry.value ?? []);
	});
	if (!found) throw new Error(`ONNX metadata "${key}" not found`);
	return found;
}

async function writeAtomic(file, bytes) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(`${file}.partial`, bytes);
	await fs.rename(`${file}.partial`, file);
}

async function verify() {
	const manifest = JSON.parse(
		await fs.readFile(path.join(destination, "manifest.json"), "utf8").catch(() => {
			throw new Error(
				"Offline OCR bundle missing. Run npm run prepare:offline-ocr on the build machine.",
			);
		}),
	);
	if (
		manifest.version !== 1 ||
		manifest.modelName !== lock.modelName ||
		manifest.runtimeVersion !== lock.runtime.version ||
		!Array.isArray(manifest.files) ||
		manifest.files.length !== required.length ||
		required.some((file) => !manifest.files.some((entry) => entry.path === file))
	)
		throw new Error("Incomplete offline OCR manifest");
	for (const entry of manifest.files) {
		const pinned = locked.find((item) => item.file === entry.path);
		if (
			!/^(?:runtime\/)?[A-Za-z0-9_.-]+$/.test(entry.path) ||
			entry.path.includes("..") ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes < 1 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256) ||
			(pinned && (pinned.size !== entry.bytes || pinned.sha256 !== entry.sha256)) ||
			!(await valid(path.join(destination, entry.path), {
				size: entry.bytes,
				sha256: entry.sha256,
			}))
		)
			throw new Error(`Invalid offline OCR asset: ${entry.path}`);
	}
}

if (!verifyOnly) {
	const wheelFile = path.join(cache, lock.wheel.file);
	await download(lock.wheel, wheelFile);
	const wheel = checked(await fs.readFile(wheelFile), lock.wheel);
	// The bundle is generated, never edited: rebuild it so no stale file gets packaged.
	await fs.rm(destination, { recursive: true, force: true });
	await fs.mkdir(path.join(destination, "runtime"), { recursive: true });

	const entries = zipEntries(wheel);
	const extracted = new Map();
	for (const entry of lock.wheel.files) {
		const bytes = unzip(wheel, entries, entry);
		extracted.set(entry.file, bytes);
		await writeAtomic(path.join(destination, entry.file), bytes);
	}

	// onnxruntime-web cannot read ONNX custom metadata, so the recognition model's CTC
	// character list (what RapidOCR reads at load time) is stored next to it unchanged.
	const dictionary = onnxMetadata(
		extracted.get(lock.dictionary.model),
		lock.dictionary.metadataKey,
	);
	if (dictionary.toString("utf8").split("\n").length !== lock.dictionary.entries)
		throw new Error("Unexpected OCR dictionary size");
	await writeAtomic(
		path.join(destination, lock.dictionary.file),
		checked(dictionary, { ...lock.dictionary }),
	);

	// The WASM runtime must be the exact onnxruntime-web build that is bundled into the worker.
	const runtimePackage = path.join(root, "node_modules", lock.runtime.package);
	const installed = JSON.parse(
		await fs.readFile(path.join(runtimePackage, "package.json"), "utf8"),
	);
	if (installed.version !== lock.runtime.version)
		throw new Error(
			`${lock.runtime.package} ${installed.version} is installed; the OCR lock pins ${lock.runtime.version}. Run npm ci.`,
		);
	for (const entry of lock.runtime.files) {
		let source = path.join(runtimePackage, entry.packagePath ?? "");
		if (!entry.packagePath) {
			source = path.join(cache, path.basename(entry.file));
			await download(entry, source);
		}
		await writeAtomic(
			path.join(destination, entry.file),
			checked(await fs.readFile(source), entry),
		);
	}

	await fs.writeFile(
		path.join(destination, "NOTICE.txt"),
		`Jsox offline OCR (Chinese + English screen text)
Models: PaddleOCR PP-OCRv6 small text detection and recognition (PP-OCRv6_small_det,
PP-OCRv6_small_rec), copyright Baidu and/or the applicable PaddleOCR rights holders,
https://github.com/PaddlePaddle/PaddleOCR, Apache-2.0.
Converted from an official PaddleOCR model to the ONNX format and packaged for use with
RapidOCR. The upstream model weights are copyright Baidu and/or the applicable PaddleOCR
rights holders and are licensed under the Apache License, Version 2.0.
ONNX files taken unchanged from ${lock.wheel.package} ${lock.wheel.version} (${lock.wheel.url}),
wheel SHA-256 ${lock.wheel.sha256}; RapidOCR is Apache-2.0, copyright (c) 2021 RapidOCR Authors.
See MODEL-LICENSE.txt (Apache-2.0) and RAPIDOCR-MODEL-LICENSES.md (attribution and provenance).
keys.txt is the "${lock.dictionary.metadataKey}" metadata of ${lock.dictionary.model}, extracted unchanged.
Pre- and post-processing are a TypeScript port of RapidOCR ${lock.wheel.version} (Apache-2.0), changed for Jsox.
Inference: ONNX Runtime Web ${lock.runtime.version} (onnxruntime-web, MIT, copyright Microsoft Corporation),
https://github.com/microsoft/onnxruntime; see runtime/ONNXRUNTIME-LICENSE.txt and
runtime/ONNXRUNTIME-THIRD-PARTY-NOTICES.txt.
No Python, network service or download is used by installed customers.
`,
	);
	const files = [];
	for (const name of required) {
		const file = path.join(destination, name);
		files.push({ path: name, bytes: (await fs.stat(file)).size, sha256: await hash(file) });
	}
	await fs.writeFile(
		path.join(destination, "manifest.json"),
		JSON.stringify(
			{
				version: 1,
				modelName: lock.modelName,
				modelLicense: lock.modelLicense,
				runtimeVersion: lock.runtime.version,
				files,
			},
			null,
			2,
		),
	);
}
await verify();
console.log(
	verifyOnly
		? "Pinned offline OCR bundle verified; no network used"
		: `Offline OCR bundle ready: ${path.relative(root, destination)}`,
);
