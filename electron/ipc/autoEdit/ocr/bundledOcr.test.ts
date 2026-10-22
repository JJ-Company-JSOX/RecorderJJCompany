import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ appPath: "", isPackaged: false }));
vi.mock("electron", () => ({
	app: {
		get isPackaged() {
			return mocks.isPackaged;
		},
		getAppPath: () => mocks.appPath,
	},
}));
import {
	createBundledOcrEngine,
	defaultOcrThreads,
	getBundledOcrRoot,
	getBundledOcrStatus,
	getOcrWorkerPath,
} from "./bundledOcr";

const FILES = {
	"PP-OCRv6_det_small.onnx": "det",
	"PP-OCRv6_rec_small.onnx": "rec",
	"keys.txt": "a\nb\n",
	"runtime/ort-wasm-simd-threaded.mjs": "export default 1;",
	"runtime/ort-wasm-simd-threaded.wasm": "wasm",
	"MODEL-LICENSE.txt": "Apache-2.0",
};

// Answers by image width: 1 echoes what it was given, 2 fails one call, 3 fails to load,
// 4 never answers, 5 crashes, 6 answers after 150 ms. Each start is logged next to the
// detection model.
const FAKE_WORKER = `
const fs = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
fs.appendFileSync(workerData.detectionModel + ".starts", "x");
let busy = Promise.resolve();
parentPort.on("message", ({ id, image }) => {
	if (image.width === 1)
		parentPort.postMessage({ id, lines: [{ text: JSON.stringify({
			threads: workerData.threads,
			runtimeVersion: workerData.runtimeVersion,
			hashed: Object.keys(workerData.sha256).length,
			bytes: image.data.length,
			options: workerData.options,
		}), score: 1, box: [0, 0, 1, 1] }] });
	else if (image.width === 2) parentPort.postMessage({ id, error: "bad crop", fatal: false });
	else if (image.width === 3) parentPort.postMessage({ id, error: "cannot load", fatal: true });
	else if (image.width === 5) process.exit(3);
	else if (image.width === 6)
		// One image at a time, like the real worker.
		busy = busy
			.then(() => new Promise((resolve) => setTimeout(resolve, 150)))
			.then(() => parentPort.postMessage({ id, lines: [] }));
});
`;

const temporary: string[] = [];
afterEach(async () => {
	for (const directory of temporary.splice(0)) {
		if (
			path.dirname(directory) !== os.tmpdir() ||
			!path.basename(directory).startsWith("jsox-ocr-test-")
		)
			throw new Error("Unsafe test cleanup");
		await fs.rm(directory, { recursive: true, force: true });
	}
	mocks.isPackaged = false;
});

async function bundle(edit?: (manifest: { files: Array<Record<string, unknown>> }) => void) {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-ocr-test-"));
	temporary.push(base);
	mocks.appPath = base;
	const root = path.join(base, "vendor", "offline-ai", "win32-x64", "ocr");
	await fs.mkdir(path.join(root, "runtime"), { recursive: true });
	const files = [];
	for (const [name, content] of Object.entries(FILES)) {
		await fs.writeFile(path.join(root, name), content);
		files.push({
			path: name,
			bytes: Buffer.byteLength(content),
			sha256: createHash("sha256").update(content).digest("hex"),
		});
	}
	const manifest = { version: 1, modelName: "PP-OCRv6 test", runtimeVersion: "1.30.0", files };
	edit?.(manifest);
	await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	const workerPath = path.join(base, "fake-worker.cjs");
	await fs.writeFile(workerPath, FAKE_WORKER);
	const starts = async () =>
		(
			await fs
				.readFile(
					path.join(await fs.realpath(root), "PP-OCRv6_det_small.onnx.starts"),
					"utf8",
				)
				.catch(() => "")
		).length;
	return { root, workerPath, starts };
}

const image = (width: number) => ({ width, height: 1, data: new Uint8Array(width * 3) });

describe("bundled OCR status and paths", () => {
	it("reports the prepared bundle without loading it", async () => {
		const { root } = await bundle();
		expect(getBundledOcrRoot()).toBe(root);
		expect(await getBundledOcrStatus()).toEqual({
			available: true,
			reason: undefined,
			modelName: "PP-OCRv6 test",
			detectionModel: "PP-OCRv6_det_small.onnx",
			recognitionModel: "PP-OCRv6_rec_small.onnx",
		});
	});

	it.each([
		[
			"a missing file",
			(m: { files: Array<Record<string, unknown>> }) => {
				m.files = m.files.filter((f) => f.path !== "keys.txt");
			},
		],
		[
			"a size mismatch",
			(m: { files: Array<Record<string, unknown>> }) => {
				m.files[0].bytes = 4;
			},
		],
		[
			"a path outside the bundle",
			(m: { files: Array<Record<string, unknown>> }) => {
				m.files.push({ path: "../manifest.json", bytes: 1, sha256: "0".repeat(64) });
			},
		],
		[
			"an unexpected runtime version",
			(m: { files: Array<Record<string, unknown>>; runtimeVersion?: string }) => {
				m.runtimeVersion = "latest";
			},
		],
	])("reports the bundle missing for %s", async (_name, edit) => {
		const { root } = await bundle(edit);
		const status = await getBundledOcrStatus(root);
		expect(status.available).toBe(false);
		expect(status.reason).toBe("missing");
	});

	it("reports a missing bundle", async () => {
		expect((await getBundledOcrStatus(path.join(os.tmpdir(), "jsox-ocr-none"))).reason).toBe(
			"missing",
		);
	});

	it("resolves packaged paths outside app.asar", () => {
		mocks.isPackaged = true;
		mocks.appPath = path.join("C:", "Jsox", "resources", "app.asar");
		expect(getOcrWorkerPath()).toBe(
			path.join(
				"C:",
				"Jsox",
				"resources",
				"app.asar.unpacked",
				"dist-electron",
				"ocr-worker.cjs",
			),
		);
		const resources = path.join("C:", "Jsox", "resources");
		Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true });
		try {
			expect(getBundledOcrRoot()).toBe(path.join(resources, "offline-ai", "ocr"));
		} finally {
			Reflect.deleteProperty(process, "resourcesPath");
		}
	});

	it("leaves one processor free and uses at most four threads", () => {
		expect([1, 2, 3, 4, 8, 12, 32].map(defaultOcrThreads)).toEqual([1, 1, 2, 3, 4, 4, 4]);
	});
});

describe("bundled OCR engine", () => {
	it("starts nothing until the first call, then reuses one worker", async () => {
		const { root, workerPath, starts } = await bundle();
		const engine = createBundledOcrEngine({
			root,
			workerPath,
			threads: 3,
			ocr: { gapSplitRatio: 0 },
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await starts()).toBe(0);
		const [line] = await engine.recognize(image(1));
		expect(JSON.parse(line.text)).toEqual({
			threads: 3,
			runtimeVersion: "1.30.0",
			hashed: Object.keys(FILES).length,
			bytes: 3,
			options: { gapSplitRatio: 0 },
		});
		await engine.recognize(image(1));
		expect(await starts()).toBe(1);
		await engine.dispose();
	});

	it("fails one call without losing the worker", async () => {
		const { root, workerPath, starts } = await bundle();
		const engine = createBundledOcrEngine({ root, workerPath });
		await expect(engine.recognize(image(2))).rejects.toThrow("bad crop");
		await expect(engine.recognize(image(1))).resolves.toHaveLength(1);
		expect(await starts()).toBe(1);
		await engine.dispose();
	});

	it("starts a fresh worker after a load failure or a crash", async () => {
		const { root, workerPath, starts } = await bundle();
		const engine = createBundledOcrEngine({ root, workerPath });
		await expect(engine.recognize(image(3))).rejects.toThrow("cannot load");
		await expect(engine.recognize(image(5))).rejects.toThrow(/exit code 3/);
		await expect(engine.recognize(image(1))).resolves.toHaveLength(1);
		expect(await starts()).toBe(3);
		await engine.dispose();
	});

	it("gives up on a stuck worker", async () => {
		const { root, workerPath, starts } = await bundle();
		const engine = createBundledOcrEngine({ root, workerPath, timeoutMs: 200 });
		await expect(engine.recognize(image(4))).rejects.toThrow(/did not answer/);
		await expect(engine.recognize(image(1))).resolves.toHaveLength(1);
		expect(await starts()).toBe(2);
		await engine.dispose();
	});

	it("times each call on its own, not the wait behind earlier calls", async () => {
		const { root, workerPath, starts } = await bundle();
		const engine = createBundledOcrEngine({ root, workerPath, timeoutMs: 400 });
		// Five 150 ms calls at once take 750 ms in all, longer than the time-out.
		const calls = Array.from({ length: 5 }, () => engine.recognize(image(6)));
		await expect(Promise.all(calls)).resolves.toEqual([[], [], [], [], []]);
		expect(await starts()).toBe(1);
		await engine.dispose();
	});

	it("copies the caller's pixels, also from a pooled Node Buffer", async () => {
		const { root, workerPath } = await bundle();
		const engine = createBundledOcrEngine({ root, workerPath });
		const data = Buffer.from([1, 2, 3]);
		const neighbour = Buffer.from("pool");
		const [line] = await engine.recognize({ width: 1, height: 1, data });
		expect(JSON.parse(line.text).bytes).toBe(3);
		expect([...data]).toEqual([1, 2, 3]);
		expect(neighbour.toString()).toBe("pool");
		await engine.dispose();
	});

	it("fails pending and later calls once disposed", async () => {
		const { root, workerPath } = await bundle();
		const engine = createBundledOcrEngine({ root, workerPath });
		const pending = expect(engine.recognize(image(4))).rejects.toThrow(/disposed/);
		await new Promise((resolve) => setTimeout(resolve, 100));
		await engine.dispose();
		await pending;
		await expect(engine.recognize(image(1))).rejects.toThrow(/disposed/);
	});

	it("rejects malformed images and missing bundles before starting a worker", async () => {
		const { root, workerPath, starts } = await bundle();
		const engine = createBundledOcrEngine({ root, workerPath });
		await expect(
			engine.recognize({ width: 2, height: 2, data: new Uint8Array(3) }),
		).rejects.toThrow(/RGB24/);
		expect(await starts()).toBe(0);
		const missing = createBundledOcrEngine({ root: path.join(root, "nope"), workerPath });
		await expect(missing.recognize(image(1))).rejects.toThrow();
		await engine.dispose();
		await missing.dispose();
	});
});
