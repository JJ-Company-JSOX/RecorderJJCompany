// onnxruntime-web (WASM, SIMD + threads) sessions for the bundled OCR models. Loaded only inside
// the OCR worker thread: no second native onnxruntime.dll enters the Electron main process,
// where sherpa-onnx already loaded its own and Windows would reuse it by module name.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import * as ort from "onnxruntime-web";
import type { RgbImage } from "../ocrTypes";
import { OCR_DEFAULTS, type OcrInference, type OcrOptions, runOcr } from "./pipeline";
import { ctcCharacters } from "./recognition";

export type OcrRuntimeAssets = {
	detectionModel: string;
	recognitionModel: string;
	dictionary: string;
	/** onnxruntime-web glue module and binary; must match the bundled onnxruntime-web version. */
	wasmModule: string;
	wasmBinary: string;
	/** Expected SHA-256 per path above; when given, every file must match before it is used. */
	sha256?: Record<string, string>;
	runtimeVersion?: string;
	threads: number;
	options?: Partial<OcrOptions>;
};

async function readVerified(file: string, sha256: Record<string, string> | undefined) {
	const bytes = await fs.readFile(file);
	if (sha256 && createHash("sha256").update(bytes).digest("hex") !== sha256[file])
		throw new Error(
			"Bundled OCR integrity check failed. Reinstall the complete offline application.",
		);
	return bytes;
}

export async function createOcrRuntime(assets: OcrRuntimeAssets) {
	const [detectionBytes, recognitionBytes, dictionary, wasmBinary] = await Promise.all([
		readVerified(assets.detectionModel, assets.sha256),
		readVerified(assets.recognitionModel, assets.sha256),
		readVerified(assets.dictionary, assets.sha256),
		readVerified(assets.wasmBinary, assets.sha256),
		readVerified(assets.wasmModule, assets.sha256),
	]);
	if (assets.runtimeVersion && ort.env.versions.web !== assets.runtimeVersion)
		throw new Error(
			`Bundled OCR runtime ${assets.runtimeVersion} does not match onnxruntime-web ${ort.env.versions.web}.`,
		);
	ort.env.logLevel = "error";
	ort.env.wasm.numThreads = assets.threads;
	ort.env.wasm.wasmBinary = wasmBinary;
	ort.env.wasm.wasmPaths = { mjs: pathToFileURL(assets.wasmModule).href };
	const sessionOptions: ort.InferenceSession.SessionOptions = {
		executionProviders: ["wasm"],
		graphOptimizationLevel: "all",
	};
	const detection = await ort.InferenceSession.create(detectionBytes, sessionOptions);
	const recognition = await ort.InferenceSession.create(recognitionBytes, sessionOptions).catch(
		async (error) => {
			await detection.release();
			throw error;
		},
	);
	const characters = ctcCharacters(dictionary.toString("utf8"));
	const options = { ...OCR_DEFAULTS, ...assets.options };

	const inference: OcrInference = {
		async detect(data, width, height) {
			const input = new ort.Tensor("float32", data, [1, 3, height, width]);
			const output = (await detection.run({ [detection.inputNames[0]]: input }))[
				detection.outputNames[0]
			];
			const [n, c, h, w] = output.dims;
			if (n !== 1 || c !== 1 || h !== height || w !== width)
				throw new Error(`Unexpected OCR detection output ${output.dims.join("x")}.`);
			return output.data as Float32Array;
		},
		async recognize(data, batch, width) {
			const input = new ort.Tensor("float32", data, [batch, 3, 48, width]);
			const output = (await recognition.run({ [recognition.inputNames[0]]: input }))[
				recognition.outputNames[0]
			];
			const [n, steps, classes] = output.dims;
			if (n !== batch || output.dims.length !== 3)
				throw new Error(`Unexpected OCR recognition output ${output.dims.join("x")}.`);
			return { data: output.data as Float32Array, steps, classes };
		},
	};

	return {
		recognize: (image: RgbImage) => runOcr(image, inference, characters, options),
		async release() {
			await Promise.all([detection.release(), recognition.release()]);
		},
	};
}
