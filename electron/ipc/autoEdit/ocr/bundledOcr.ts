// Bundled offline OCR (Chinese + English UI text) for the narration pipeline. The models and
// the onnxruntime-web WASM runtime ship in resources/offline-ai/ocr; inference runs in a
// worker thread that starts on the first recognize() and stops on dispose().
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { app } from "electron";
import { resolveUnpackedAppPath } from "../../paths/binaries";
import type { OcrEngine, OcrLine, RgbImage } from "../ocrTypes";
import { assertRgbImage } from "./image";
import type { OcrOptions } from "./pipeline";
import type { OcrRuntimeAssets } from "./runtime";
import type { OcrWorkerRequest, OcrWorkerResponse } from "./worker";

export const OCR_MODEL_NAME = "PP-OCRv6 small (RapidOCR ONNX)";
const DETECTION_MODEL = "PP-OCRv6_det_small.onnx";
const RECOGNITION_MODEL = "PP-OCRv6_rec_small.onnx";
const DICTIONARY = "keys.txt";
const WASM_MODULE = "runtime/ort-wasm-simd-threaded.mjs";
const WASM_BINARY = "runtime/ort-wasm-simd-threaded.wasm";
const REQUIRED = [DETECTION_MODEL, RECOGNITION_MODEL, DICTIONARY, WASM_MODULE, WASM_BINARY];
const ALLOWED_PATH = /^(?:runtime\/)?[A-Za-z0-9_.-]+$/;

type OcrManifest = {
	version: 1;
	modelName: string;
	runtimeVersion: string;
	files: Array<{ path: string; bytes: number; sha256: string }>;
};

export function getBundledOcrRoot() {
	return app.isPackaged
		? path.join(process.resourcesPath, "offline-ai", "ocr")
		: path.join(app.getAppPath(), "vendor", "offline-ai", "win32-x64", "ocr");
}

/**
 * The worker is built next to main.cjs. Packaged builds unpack it from app.asar
 * (electron-builder.offline.json5 asarUnpack): a worker thread loads its entry from disk.
 */
export function getOcrWorkerPath() {
	return resolveUnpackedAppPath("dist-electron", "ocr-worker.cjs");
}

function within(root: string, file: string) {
	const relative = path.relative(root, file);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readManifest(root: string) {
	const canonicalRoot = await fs.realpath(root);
	const manifestPath = await fs.realpath(path.join(root, "manifest.json"));
	if (!within(canonicalRoot, manifestPath) || (await fs.stat(manifestPath)).size > 64_000)
		throw new Error("Invalid bundled OCR manifest.");
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as OcrManifest;
	if (
		manifest.version !== 1 ||
		typeof manifest.modelName !== "string" ||
		!manifest.modelName.trim() ||
		typeof manifest.runtimeVersion !== "string" ||
		!/^\d+\.\d+\.\d+$/.test(manifest.runtimeVersion) ||
		!Array.isArray(manifest.files) ||
		manifest.files.length > 32 ||
		!REQUIRED.every((name) => manifest.files.some((entry) => entry?.path === name))
	)
		throw new Error("Invalid bundled OCR manifest.");
	const seen = new Set<string>();
	const sha256: Record<string, string> = {};
	for (const entry of manifest.files) {
		if (
			typeof entry?.path !== "string" ||
			!ALLOWED_PATH.test(entry.path) ||
			entry.path.includes("..") ||
			seen.has(entry.path.toLowerCase()) ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes <= 0 ||
			typeof entry.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		)
			throw new Error("Invalid bundled OCR asset.");
		seen.add(entry.path.toLowerCase());
		const canonicalPath = await fs.realpath(path.join(canonicalRoot, entry.path));
		const stat = await fs.stat(canonicalPath);
		if (!within(canonicalRoot, canonicalPath) || !stat.isFile() || stat.size !== entry.bytes)
			throw new Error(
				"Bundled OCR assets are missing or corrupt. Reinstall the complete offline application.",
			);
		sha256[path.join(canonicalRoot, entry.path)] = entry.sha256;
	}
	return { manifest, canonicalRoot, sha256 };
}

// Status performs only metadata checks; no model load or large hash scan on startup.
export async function getBundledOcrStatus(root = getBundledOcrRoot()) {
	const names = { detectionModel: DETECTION_MODEL, recognitionModel: RECOGNITION_MODEL };
	try {
		const { manifest } = await readManifest(root);
		return { available: true, reason: undefined, modelName: manifest.modelName, ...names };
	} catch {
		return {
			available: false,
			reason: "missing" as const,
			modelName: OCR_MODEL_NAME,
			...names,
		};
	}
}

/**
 * One thread per logical processor but one (left for the UI and ffmpeg), at most four. On a
 * quiet 4-vCPU machine 3-4 WASM threads read a 768x432 crop in about 1.3-1.5 s and 2 threads
 * in 2.1 s; past four, the measured gain is small and the rest of the app slows down.
 */
export const defaultOcrThreads = (logical = os.availableParallelism()) =>
	Math.max(1, Math.min(4, logical - 1));

/** A request that takes this long means a stuck worker; it is stopped and the call fails. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Creates the bundled OCR engine. Nothing is read or started until the first recognize();
 * the SHA-256 of every model and runtime file is checked in the worker before loading.
 * Calls are answered in order, one at a time, by one worker; dispose() stops it and fails
 * pending calls.
 */
export function createBundledOcrEngine(
	options: {
		root?: string;
		workerPath?: string;
		threads?: number;
		timeoutMs?: number;
		ocr?: Partial<OcrOptions>;
	} = {},
): OcrEngine {
	let worker: Worker | null = null;
	let starting: Promise<Worker> | null = null;
	let disposed = false;
	let nextId = 1;
	const pending = new Map<
		number,
		{
			resolve: (lines: OcrLine[]) => void;
			reject: (error: Error) => void;
			timer: NodeJS.Timeout;
			owner: Worker;
		}
	>();

	const settle = (id: number) => {
		const request = pending.get(id);
		pending.delete(id);
		if (request) clearTimeout(request.timer);
		return request;
	};
	// Only the calls sent to `owner`: a stopping worker must not fail its successor's calls.
	const failAll = (error: Error, owner?: Worker) => {
		for (const [id, request] of [...pending])
			if (!owner || request.owner === owner) settle(id)?.reject(error);
	};
	// Forgets the worker first, so the next recognize() starts a fresh one.
	const stop = async (current: Worker | null) => {
		if (current && worker === current) {
			worker = null;
			starting = null;
		}
		await current?.terminate();
	};

	async function start() {
		const { manifest, canonicalRoot, sha256 } = await readManifest(
			options.root ?? getBundledOcrRoot(),
		);
		if (disposed) throw new Error("The OCR engine was disposed.");
		const file = (name: string) => path.join(canonicalRoot, name);
		const workerData: OcrRuntimeAssets = {
			detectionModel: file(DETECTION_MODEL),
			recognitionModel: file(RECOGNITION_MODEL),
			dictionary: file(DICTIONARY),
			wasmModule: file(WASM_MODULE),
			wasmBinary: file(WASM_BINARY),
			sha256,
			runtimeVersion: manifest.runtimeVersion,
			threads: options.threads ?? defaultOcrThreads(),
			options: options.ocr,
		};
		const created = new Worker(options.workerPath ?? getOcrWorkerPath(), { workerData });
		created.on("message", (response: OcrWorkerResponse) => {
			const request = settle(response.id);
			if ("lines" in response) request?.resolve(response.lines);
			else {
				request?.reject(new Error(response.error));
				// A failed load cannot recover in this worker; the next call starts a fresh one.
				if (response.fatal) {
					failAll(new Error(response.error), created);
					void stop(created);
				}
			}
		});
		created.on("error", (error: Error) => {
			failAll(error, created);
			void stop(created);
		});
		created.on("exit", (code) => {
			if (worker === created) {
				worker = null;
				starting = null;
			}
			failAll(new Error(`The OCR worker stopped (exit code ${code}).`), created);
		});
		worker = created;
		return created;
	}

	// The pixels are moved to the worker, so they must be a private ArrayBuffer.
	async function run(image: RgbImage & { data: Uint8Array<ArrayBuffer> }) {
		if (disposed) throw new Error("The OCR engine was disposed.");
		if (!starting) {
			const attempt = start();
			starting = attempt;
			attempt.catch(() => {
				if (starting === attempt) starting = null;
			});
		}
		const current = await starting;
		// The worker may have stopped while this call waited for it to start.
		if (disposed || worker !== current) throw new Error("The OCR worker stopped.");
		const id = nextId++;
		return new Promise<OcrLine[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				const error = new Error("The OCR worker did not answer in time.");
				failAll(error, current);
				void stop(current);
			}, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
			pending.set(id, { resolve, reject, timer, owner: current });
			const request: OcrWorkerRequest = { id, image };
			current.postMessage(request, [image.data.buffer]);
		});
	}

	// One request in the worker at a time, so the time-out measures the work on one image,
	// not the wait behind earlier calls (a slow 1-thread laptop with many calls queued).
	let queue: Promise<unknown> = Promise.resolve();

	return {
		async recognize(image: RgbImage) {
			assertRgbImage(image);
			if (disposed) throw new Error("The OCR engine was disposed.");
			// A private copy (also of a Node Buffer, whose slice() would share memory): the caller
			// may reuse its pixels while this call waits, and the copy is moved to the worker.
			const copy = {
				width: image.width,
				height: image.height,
				data: new Uint8Array(image.data),
			};
			const turn = queue.then(() => run(copy));
			queue = turn.catch(() => undefined);
			return turn;
		},
		async dispose() {
			disposed = true;
			const current = worker ?? (await starting?.catch(() => null)) ?? null;
			failAll(new Error("The OCR engine was disposed."));
			await stop(current);
		},
	};
}

/**
 * Opens the bundled OCR engine for one voice-over job. Without a complete OCR bundle (developer
 * checkouts, older offline packages) it resolves undefined and the vision model reads the labels
 * on its own; a bundle whose worker entry is missing is a broken build and throws once, instead
 * of failing every click. Nothing loads here: the worker starts on the first recognize(), and
 * the caller disposes the engine when the job ends.
 */
export async function openBundledOcr(
	signal?: AbortSignal,
	options: { root?: string; workerPath?: string } = {},
): Promise<OcrEngine | undefined> {
	const root = options.root ?? getBundledOcrRoot();
	const status = await getBundledOcrStatus(root);
	signal?.throwIfAborted();
	if (!status.available) return undefined;
	const workerPath = options.workerPath ?? getOcrWorkerPath();
	await fs.access(workerPath).catch(() => {
		throw new Error("The OCR worker is missing from this build.");
	});
	signal?.throwIfAborted();
	return createBundledOcrEngine({ root, workerPath });
}
